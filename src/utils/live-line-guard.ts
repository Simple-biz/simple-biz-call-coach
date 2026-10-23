/**
 * The same code-level guards today's coach runs in parseAITipResponse (infra/lib/lambda/shared/
 * claude-client-optimized.ts), applied to the live coach's lines. Live lines go straight from the
 * gateway to the extension, so without this they would skip the backend's guards.
 *
 * fixWeakEnding is not applied: it needs the call stage, which only the backend knows, and after a
 * lead agrees a confirmation ending is correct.
 */
import { mentionsPrice, PRICING_REDIRECT } from '../../infra/lib/lambda/shared/price-guard'
import { claimsUnscriptedFact, addHisPartner, SCRIPT_DEFLECT, CALLBACK_ASK } from '../../infra/lib/lambda/shared/script-guard'
import {
  DECLINE_LINE, SIGNOFF_LINE, OPENER, REBUTTALS, CLOSE_NAME, CLOSE_DECISION_MAKER, CLOSE_PURPOSE, DECISION_PIVOT, PURPOSE_PIVOT,
} from '../../infra/lib/experiments/live-coach-instructions'

/**
 * @returns the line to show, or null to hold a draft back (a half-written line that is already
 *   quoting a price or making an unscripted claim is not streamed; its final version is replaced).
 */
export function guardLiveLine(text: string, final: boolean): string | null {
  const offScript = mentionsPrice(text) ? PRICING_REDIRECT : claimsUnscriptedFact(text) ? SCRIPT_DEFLECT : null
  if (offScript) return final ? offScript : null
  return oneCallbackStatement(oneCallbackAsk(withoutForbiddenAsks(addHisPartner(text))))
}

// Mass test round 2 (2026-10-23): the coach asked "What's the best number for him to reach you?" (we
// dialed them; the script forbids it), read a misheard email back four times ("lewis@tacolewis.com"
// for luis@tacoluis.com), and read a made-up placeholder aloud ("[the owner]"). Sentences doing the
// first two are dropped; owner placeholders become plain words. Only [Agent], [Place], [Bob's number]
// and [their date] are real placeholders.
const PHONE_ASK = /\b(?:best|good|right|direct|cell)(?: phone)? number\b|\b(?:is|on|at) this (?:the best )?number\b|\bnumber (?:to|for) (?:reach|call)|\byour (?:phone )?number\b/i
const EMAIL_ADDRESS = /\S+@\S+\.[a-z]{2,}/i

// Mass test round 3: the coach twice made up Bob's number ("555-123-4567") instead of writing the
// placeholder, and the lead wrote it down. Any phone number it writes becomes [Bob's number], which
// the agent fills from their own screen. A curly apostrophe in the placeholder is straightened.
const PHONE_DIGITS = /(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b/g

export function withoutForbiddenAsks(text: string): string {
  const fixed = text
    .replace(PHONE_DIGITS, "[Bob's number]")
    .replace(/\[Bob[’‘]s number\]/g, "[Bob's number]")
    .replace(/\[(?:the )?owner(?:'s name)?\]/gi, 'the owner')
    .replace(/,?\s*\[(?:their )?name\]/gi, '')
  const sentences = fixed.split(/(?<=[.!?])\s+/)
  const kept = sentences.filter((s) => !PHONE_ASK.test(s) && !EMAIL_ADDRESS.test(s))
  if (kept.length === sentences.length) return fixed
  return kept.length ? kept.join(' ').trim() : CALLBACK_ASK
}

// The simulator caught the live coach reading two or three rebuttals back to back, each ending in
// the callback question. Only the last ask is kept; the answers before it stay.
const CALLBACK_QUESTION = /\s*Would you mind if I have (?:Bob or his partner|them|either of them|him) give you a call[^?]*\?/gi

export function oneCallbackAsk(text: string): string {
  const asks = text.match(CALLBACK_QUESTION)
  if (!asks || asks.length < 2) return text
  let seen = 0
  return text.replace(CALLBACK_QUESTION, (m) => (++seen < asks.length ? '' : m)).replace(/\s{2,}/g, ' ').trim()
}

// Mass test 2026-10-23: the confirm line and the sign-off came out glued together, with the callback
// stated twice ("I'll have Bob or his partner reach out to you later today. Got it. Bob or his partner
// will give you a call later today."). The first statement is kept, later ones and the mid-line
// "Got it." are dropped.
const CALLBACK_STATEMENT = /\b(?:I'll have Bob or his partner reach out|Bob or his partner will (?:reach out|give (?:you|them|him|her) a call))\b/i

export function oneCallbackStatement(text: string): string {
  const sentences = text.replace(/([.!?])\s+Got it\.(?=\s|$)/g, '$1').split(/(?<=[.!?])\s+/)
  let stated = false
  const kept = sentences.filter((s) => {
    if (!CALLBACK_STATEMENT.test(s) || s.trim().endsWith('?')) return true
    if (stated) return false
    stated = true
    return true
  })
  return kept.join(' ').trim()
}

/**
 * Per-call state the pure guard can't hold. Mass test 2026-10-23: four booked callbacks ended on the
 * decline line ("No problem. I appreciate you taking my call."), which tells a lead who just said yes
 * that the call is off. Once a line has confirmed the callback, the decline line becomes the sign-off.
 */
export const MAX_CALLBACK_ASKS = 2
export const MAX_BOB_OR_PARTNER = 2

export class LiveLineGuard {
  private confirmed = false
  private pastHello = false
  private askedLastLine = false
  private asks = 0
  private bobOrPartner = 0

  apply(text: string, final: boolean): string | null {
    let line = guardLiveLine(text, final)
    if (line === null || !final) return line
    this.prevAsked = this.askedLastLine
    if (this.confirmed && line.trim() === DECLINE_LINE) line = SIGNOFF_LINE
    // Kayser's test call, 2026-10-23: the lead answered the hello with "Doing good, thanks" and the
    // coach said its goodbye; the call stalled before the pitch was ever given. A goodbye right
    // after the hello becomes the pitch. Only there: 43 simulated calls later, a lead who skipped
    // the hello for questions never heard the pitch's exact words, and her real goodbye after a
    // booked callback was turned into the pitch (3 of 4 runs). Any line past the hello ends it.
    if (!this.pastHello && GOODBYE.test(line)) line = OPENER
    if (!/how are you/i.test(line)) this.pastHello = true
    // Verify run, 2026-10-24: the callback question asked again after the lead had said yes. After
    // a yes it's settled: the ask goes (the answer stays), and a line that was only the ask moves
    // the close on.
    if (this.confirmed && ANY_CALLBACK_ASK.test(line) && !THEIR_TIME.test(line)) {
      line = line.replace(ANY_CALLBACK_ASK_G, '').replace(/\s{2,}/g, ' ').trim() || this.nextCloseStep()
    }
    // Kayser's test calls, 2026-10-23: the callback question on 7 lines in 3 minutes, then on 4
    // lines in 2.5 minutes once it could no longer come twice in a row. Of 170 good booked calls in
    // the 500 mined, 161 asked it once or not at all. Never in two lines in a row, never more than
    // twice a call: past that the answer stands on its own.
    // An ask that names the lead's own time ("...call you tomorrow morning before ten?") confirms
    // their yes and always stands. Sim 2026-10-23: dropping one left just "Sure,".
    if (ANY_CALLBACK_ASK.test(line) && !THEIR_TIME.test(line)) {
      const answerOnly = line.replace(ANY_CALLBACK_ASK_G, '').replace(/\s{2,}/g, ' ').trim()
      const hasAnswer = answerOnly.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w)).length >= 3
      const pivot = !this.askedWho ? DECISION_PIVOT : !this.askedPurpose ? PURPOSE_PIVOT : null
      // A reply to a lead who is hedging ("I understand you're busy") keeps its ask once the
      // top bookers' questions are used up: that ask is their question there (88% of their
      // busy replies end on one).
      const hedgeKeepsAsk = !this.askedLastLine && !pivot && HEDGE_REPLY.test(answerOnly)
      if ((this.askedLastLine || this.asks >= MAX_CALLBACK_ASKS) && hasAnswer && !hedgeKeepsAsk) {
        line = answerOnly
        this.askedLastLine = false
      } else if (this.asks >= MAX_CALLBACK_ASKS && pivot) {
        // A line that is only a third ask (sim: "the third callback question of the call") becomes
        // one of the top bookers' questions instead.
        line = pivot
        this.askedLastLine = false
      } else {
        this.askedLastLine = true
        this.asks++
      }
    } else {
      this.askedLastLine = false
    }
    // The close's own last line isn't proof of a yes: the model wrote one to a lead who only asked
    // for an email (verify run, 2026-10-24).
    if (((CALLBACK_STATEMENT.test(line) && !/would you mind/i.test(line)) || line.includes(CLOSE_NAME)) && !CLOSE_DONE_ANY.test(line)) this.confirmed = true
    // The month's top 8 bookers said "Bob or his partner" 0.66 times a call (186 bookings,
    // 2026-10-23); the coach said it 5-6 times. Past the second, it's just "Bob".
    // After endOnAQuestion, so a callback ask it adds counts too.
    line = this.endOnAQuestion(line)
    return line.replace(/\bBob or (?:his|one of his) partners?\b/gi, (m) => (++this.bobOrPartner > MAX_BOB_OR_PARTNER ? 'Bob' : m))
  }

  private askedWho = false
  private askedPurpose = false
  private lastCheck = ''
  private timeConfirmed = false
  private when = 'later today'
  private doneSaid = false
  private askedName = false
  private prevAsked = false

  /**
   * Kayser, 2026-10-23: "let's not leave the lead without them having to answer, we should not be
   * the conversation ender." The top bookers ended 3 replies in 4 on a question. Until the callback
   * is agreed, a line that doesn't (often one whose callback ask was just dropped above) gets, in
   * order: who handles the website, build or update (each once a call; the close's own versions
   * count), "Would that be okay?" after saying what Bob will do, else the callback ask when the
   * line before didn't ask. Only questions the top bookers really ask: Kayser's third test call
   * was full of "Does that help?", which appears in none of their 186 bookings.
   */
  private endOnAQuestion(line: string): string {
    line = this.skipAskedCloseQuestion(line).replace(/\s*(?:Does that help|Fair enough)\?\s*$/i, '')
    if (line.includes(DECISION_PIVOT) || /someone else in charge|\bthe owner\b|who should bob/i.test(line)) this.askedWho = true
    if (line.includes(PURPOSE_PIVOT) || line.includes(CLOSE_PURPOSE) || /glad I called/i.test(line)) this.askedPurpose = true
    const t = line.trim()
    const check = this.lastCheck
    this.lastCheck = ''
    if (t.endsWith('?') || GOODBYE.test(t) || t.includes(CLOSE_DONE_SHORT)) return line
    if (this.confirmed) {
      // Kayser's third test call: "Sure, I'll have Bob call you tomorrow morning before ten." ended
      // flat and the lead had to ask "You said you had one more question?". The close goes on.
      if (!this.askedWho) {
        this.askedWho = true
        return `${t} ${CLOSE_DECISION_MAKER}`
      }
      if (!this.askedPurpose) {
        this.askedPurpose = true
        return `${t} ${CLOSE_PURPOSE}`
      }
      // Kayser, 2026-10-24: "it should not be the conversation ender, sometimes leads don't answer".
      // A flat confirmation ("Bob will give you a call later today.") gets the top bookers' check.
      const next = /\b(?:call|reach out)\b/i.test(t) && check !== WORK_CHECK ? WORK_CHECK : check !== OKAY_TAG ? OKAY_TAG : ''
      if (!next) return line
      this.lastCheck = next
      return `${t} ${next}`
    }
    if (!this.askedWho) {
      this.askedWho = true
      return `${t} ${DECISION_PIVOT}`
    }
    if (!this.askedPurpose) {
      this.askedPurpose = true
      return `${t} ${PURPOSE_PIVOT}`
    }
    if (/\b(?:Bob (?:can|will)|I'll have Bob)\b/.test(t) && check !== OKAY_CHECK) {
      this.lastCheck = OKAY_CHECK
      return `${t} ${OKAY_CHECK}`
    }
    if (!this.prevAsked || HEDGE_REPLY.test(t)) {
      this.askedLastLine = true
      this.asks++
      // Right after an ask, a busy lead gets the top bookers' softer version instead of the same
      // question twice ("Is it okay to talk to you later today when you're less busy instead?").
      return `${t} ${this.prevAsked ? BUSY_ASK : CALLBACK_ASK}`
    }
    // Nothing else left to ask right after an ask ("Bob is in Topeka."): their most common tag.
    if (check === OKAY_TAG) return line
    this.lastCheck = OKAY_TAG
    return `${t} ${OKAY_TAG}`
  }

  /** The close asks who decides, then build or update; a question the call already had is skipped. */
  private skipAskedCloseQuestion(line: string): string {
    // Sim 2026-10-23: "Sure, I'll have Bob call you tomorrow morning before ten." then a last line
    // of "...will give you a call later today." The time the lead agreed is kept, and the close's
    // last line reads it back (the judge kept noting it was never said back) and asks if it works.
    const agreed = /\bI'll have Bob\b[^.?!]*?\bcall you\b([^.?!]*)/i.exec(line)
    if (agreed) {
      this.timeConfirmed = true
      if (agreed[1].trim()) this.when = agreed[1].trim()
    }
    // Verify run, 2026-10-24: after "Would that work for you?" / "Yes, that works, thanks" the
    // model said the whole close again in its own words ("I've got everything set... Would that
    // work for you?"). Once the close is said and answered, a line restating it is the goodbye.
    if (this.doneSaid && CLOSE_RESTATED.test(line)) return SIGNOFF_LINE
    if (CLOSE_DONE_ANY.test(line)) {
      const stated = /\bwill give you a call ([^.?!]+)/i.exec(line)
      if (!this.timeConfirmed && stated) this.when = stated[1].trim()
      // Verify run: an email-only lead got "I've got everything I need" without ever agreeing to a
      // call, and other calls skipped who decides and build or update. The close needs the yes,
      // then its questions.
      if (!this.confirmed) return CALLBACK_ASK
      return this.askedWho && this.askedPurpose ? this.done() : this.nextCloseStep()
    }
    if (line.includes(CLOSE_PURPOSE) && this.askedPurpose) return this.confirmed ? this.done() : CALLBACK_ASK
    // The close's who-decides question, in any wording, and the one the email and receptionist
    // lines end with ("...or is there someone else in charge of that?"); and the name question
    // (sim 2026-10-23: asked three times, "like I told you earlier"). Once the call has asked one,
    // that sentence goes; a line that was only that moves on to the close's next step.
    for (const [asked, question] of [[this.askedWho, /someone else in charge/i], [this.askedName, /first name/i]] as const) {
      if (!asked || !question.test(line)) continue
      const kept = sentences(line).filter((s) => !question.test(s)).join(' ').trim()
      // Before a yes there's no close to move on to (verify run: after a "Maybe." the who-decides
      // question, already asked, became "I've got everything I need"): it's the callback ask.
      if (!kept) return this.confirmed ? this.nextCloseStep() : CALLBACK_ASK
      line = kept
    }
    if (/first name/i.test(line)) this.askedName = true
    return line
  }

  private nextCloseStep(): string {
    if (!this.askedWho) return CLOSE_DECISION_MAKER
    if (!this.askedPurpose) return CLOSE_PURPOSE
    // Close already said: confirm the time again (picking up one named since, "around 2:30"), not
    // a goodbye while the lead is still talking (verify run).
    if (this.doneSaid) return `Just to confirm, Bob or his partner will call you ${this.whenText()}. ${OKAY_TAG}`
    return this.done()
  }

  /** The agreed time, or the lead's own words when the coach only had "later today". */
  private whenText(): string {
    return this.when === 'later today' && this.leadTime ? this.leadTime : this.when
  }

  /**
   * The close's last line, with the agreed time read back and a question the lead answers: never a
   * goodbye before theirs (a goodbye the model tacked on is dropped). The close is said once: after
   * the lead has answered it, it's the goodbye.
   */
  private done(): string {
    if (this.doneSaid) return SIGNOFF_LINE
    this.doneSaid = true
    // The lead's own words when the coach only had "later today" (verify run: "mid-afternoon" and
    // "until about five" came back as "later today").
    return `${CLOSE_DONE_SHORT} Bob or his partner will give you a call ${this.whenText()}. ${WORK_CHECK}`
  }

  private leadTime = ''

  /** What the lead just said: a time they name is kept for the close. */
  noteLead(text: string): void {
    const m = LEAD_TIME.exec(text)
    if (m) this.leadTime = m[0].toLowerCase().replace(/^until (?:about )?/, 'before ').replace(/^by about /, 'by ')
  }
}

// Any version of the close's last line, the model's or ours.
const CLOSE_DONE_ANY = /\bI(?:'ve| have) got everything (?:I need|set)\b|\bI have everything I need\b/i
// The close said again: its last line, or a restated callback time with "would that work" / "okay".
// (Verify run: "Great, I'll have Bob give you a call tomorrow morning before ten. Would that work
// for you?" after the lead had answered the close slipped past "will give you a call".)
const CLOSE_RESTATED = /\bI(?:'ve| have) got everything\b|\bI have everything I need\b|\b(?:give you a call|call you)\b[^?]*\b(?:would that work|okay)\b/i
// A time the lead names: "mid-afternoon", "until about five", "tomorrow morning before ten".
const LEAD_TIME = /\b(?:tomorrow(?: (?:morning|afternoon|evening))?(?: (?:before|after|around|at) (?:\d{1,2}(?::\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon))?|(?:this|later this) (?:morning|afternoon|evening)|mid-?(?:morning|afternoon)|(?:before|after|around|at|by|until) (?:about )?(?:\d{1,2}(?::\d{2})?(?: ?[ap]\.?m\.?)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon)|(?:in|within) (?:a day or two|an hour|a couple (?:of )?(?:hours|days)|\d+ (?:minutes|hours))|next week|(?:on )?(?:monday|tuesday|wednesday|thursday|friday))\b/i

// After a line saying what Bob will do; in 34 of the top bookers' 186 bookings.
const OKAY_CHECK = 'Would that be okay?'
const BUSY_ASK = "Is it okay if Bob calls you later today, when you're less busy?"
// The top bookers' checks: "Would that work?" in 22 of their 186 bookings, "okay?" in 136.
const WORK_CHECK = 'Would that work for you?'
const OKAY_TAG = 'Okay?'

// The close's last line when the time was already confirmed in an earlier line.
const CLOSE_DONE_SHORT = "Perfect, I've got everything I need."

// A line that ends the call needs no question after it, in any wording (sim 2026-10-23: "No
// problem. I appreciate your time—thanks again." got a question tacked on after a clear no).
const GOODBYE = /appreciate (?:you taking my call|your time)|have a (?:great|beautiful|good|nice) day|take care|good ?bye|\bbye\b|thanks again|off (?:our|the|your) list/i

// The answer part of a reply to a lead who is busy, unsure or "not right now".
const HEDGE_REPLY = /\b(?:busy|understand|no problem|not right now|maybe)\b/i

// A day or time the lead named, other than the default "later today".
const THEIR_TIME = /\b(?:tomorrow|morning|afternoon|evening|tonight|noon|monday|tuesday|wednesday|thursday|friday|next week|before (?:ten|\d)|after (?:three|\d)|at \d|in \d+ minutes)\b/i

// Sentences, without splitting after "Dr." and the like (sim: "Would they talk to Dr. Patel...").
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms|St|Jr)\.)\s+/)
}

// Any form of the callback question: "Would you mind if I have Bob or his partner give you a call
// ...?", "...reach out to you later today?", "Would it be okay if Bob or his partner...?".
const ANY_CALLBACK_ASK_SRC = String.raw`\s*(?:Would you mind|Would it be okay|Is it okay|Can I have)[^?]*(?:give (?:you|them|him|her|the owner)[^?]*call|reach out|call you)[^?]*\?`
const ANY_CALLBACK_ASK = new RegExp(ANY_CALLBACK_ASK_SRC, 'i')
const ANY_CALLBACK_ASK_G = new RegExp(ANY_CALLBACK_ASK_SRC, 'gi')

// A lead pushing the website to later: "not until next year", "at some point", "after the holidays".
const FUTURE_TIME = /\b(?:next (?:year|month|quarter|spring|summer|fall|winter|season)|in the new year|after the (?:holidays|new year|season|busy season)|(?:later|early|end of) (?:this|next) year|this (?:spring|summer|fall|winter)|until (?:next|the|after|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|winter)|at some point|eventually|down the road)\b/i
// The date itself, to fill [their date] with the lead's own words.
const FUTURE_DATE = /\b(?:next (?:year|month|quarter|spring|summer|fall|winter|season)|the new year|after the (?:holidays|new year|season|busy season)|(?:later|early|the end of) (?:this|next) year|this (?:spring|summer|fall|winter)|january|february|march|april|may|june|july|august|september|october|november|december)\b/i
const FUTURE_DATE_LINE = REBUTTALS.find(([when]) => when.startsWith('Mentions a future date'))![1]

/**
 * Simulated calls, 2026-10-23: a lead saying "we could use a better website, but we're not looking
 * to do anything until next year. Thanks for calling though." got the decline line twice in one
 * round (and in earlier rounds), dropping an interested decision maker. The instructions already say
 * a future date is not a no; the model keeps slipping on the "thanks for calling". When the coach
 * gives the decline line to a lead who named a later time, the script's future-date line goes
 * instead, with their date filled in. A plain "no thanks, I don't need a website" keeps the decline.
 */
export function futureDateInsteadOfDecline(line: string, leadText: string): string {
  if (line.trim() !== DECLINE_LINE || !FUTURE_TIME.test(leadText)) return line
  const date = FUTURE_DATE.exec(leadText)?.[0]
  return date ? FUTURE_DATE_LINE.replace('[their date]', date.toLowerCase()) : FUTURE_DATE_LINE
}
