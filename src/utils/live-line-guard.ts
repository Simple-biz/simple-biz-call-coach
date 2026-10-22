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
  DECLINE_LINE, SIGNOFF_LINE, CLOSE_NAME, CLOSE_DECISION_MAKER, CLOSE_PURPOSE, DECISION_PIVOT, PURPOSE_PIVOT,
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
  private askedLastLine = false
  private asks = 0
  private bobOrPartner = 0

  apply(text: string, final: boolean): string | null {
    let line = guardLiveLine(text, final)
    if (line === null || !final) return line
    if (this.confirmed && line.trim() === DECLINE_LINE) line = SIGNOFF_LINE
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
    if ((CALLBACK_STATEMENT.test(line) && !/would you mind/i.test(line)) || line.includes(CLOSE_NAME)) this.confirmed = true
    // The month's top 8 bookers said "Bob or his partner" 0.66 times a call (186 bookings,
    // 2026-10-23); the coach said it 5-6 times. Past the second, it's just "Bob".
    line = line.replace(/\bBob or (?:his|one of his) partners?\b/gi, (m) => (++this.bobOrPartner > MAX_BOB_OR_PARTNER ? 'Bob' : m))
    return this.endOnAQuestion(line)
  }

  private askedWho = false
  private askedPurpose = false
  private lastCheck = ''
  private timeConfirmed = false
  private doneSaid = false
  private askedName = false

  /**
   * Kayser, 2026-10-23: "let's not leave the lead without them having to answer, we should not be
   * the conversation ender." The top bookers ended 3 replies in 4 on a question. Until the callback
   * is agreed, a line that doesn't (often one whose callback ask was just dropped above) gets the
   * next of their two questions the call hasn't had yet (the close's own versions count), then one
   * of their short checks, never the same check two lines running.
   */
  private endOnAQuestion(line: string): string {
    line = this.skipAskedCloseQuestion(line)
    if (line.includes(DECISION_PIVOT) || /someone else in charge|\bthe owner\b|who should bob/i.test(line)) this.askedWho = true
    if (line.includes(PURPOSE_PIVOT) || line.includes(CLOSE_PURPOSE) || /glad I called/i.test(line)) this.askedPurpose = true
    const t = line.trim()
    const check = this.lastCheck
    this.lastCheck = ''
    if (this.confirmed || t.endsWith('?') || GOODBYE.test(t) || t.includes(CLOSE_DONE_SHORT)) return line
    if (!this.askedWho) {
      this.askedWho = true
      return `${t} ${DECISION_PIVOT}`
    }
    if (!this.askedPurpose) {
      this.askedPurpose = true
      return `${t} ${PURPOSE_PIVOT}`
    }
    const options = /\b(?:Bob (?:can|will)|I'll have Bob)\b/.test(t) ? ['Would that be okay?', 'Fair enough?'] : ['Does that help?', 'Fair enough?']
    const next = options.find((o) => o !== check)!
    this.lastCheck = next
    return `${t} ${next}`
  }

  /** The close asks who decides, then build or update; a question the call already had is skipped. */
  private skipAskedCloseQuestion(line: string): string {
    // Sim 2026-10-23: "Sure, I'll have Bob call you tomorrow morning before ten." then a last line
    // of "...will give you a call later today." Once the lead's time is confirmed, the last line
    // doesn't restate a time.
    if (/\bI'll have Bob\b[^.?!]*\bcall you\b/i.test(line)) this.timeConfirmed = true
    if (this.timeConfirmed && line.includes(CLOSE_DONE_SHORT)) return this.done(line.includes(SIGNOFF_LINE))
    if (line.includes(CLOSE_PURPOSE) && this.askedPurpose) return this.done(false)
    // The close's who-decides question, in any wording, and the one the email and receptionist
    // lines end with ("...or is there someone else in charge of that?"); and the name question
    // (sim 2026-10-23: asked three times, "like I told you earlier"). Once the call has asked one,
    // that sentence goes; a line that was only that moves on to the close's next step.
    for (const [asked, question] of [[this.askedWho, /someone else in charge/i], [this.askedName, /first name/i]] as const) {
      if (!asked || !question.test(line)) continue
      const kept = sentences(line).filter((s) => !question.test(s)).join(' ').trim()
      if (!kept) return this.nextCloseStep()
      line = kept
    }
    if (/first name/i.test(line)) this.askedName = true
    if (line.includes(CLOSE_DONE_SHORT)) this.doneSaid = true
    return line
  }

  private nextCloseStep(): string {
    if (!this.askedWho) return CLOSE_DECISION_MAKER
    if (!this.askedPurpose) return CLOSE_PURPOSE
    return this.done(false)
  }

  /** The close's last line, said once; after that only the goodbye. */
  private done(withSignoff: boolean): string {
    const said = this.doneSaid
    this.doneSaid = true
    if (said) return SIGNOFF_LINE
    return withSignoff ? `${CLOSE_DONE_SHORT} ${SIGNOFF_LINE}` : CLOSE_DONE_SHORT
  }
}

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
