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
import { DECLINE_LINE, SIGNOFF_LINE } from '../../infra/lib/experiments/live-coach-instructions'

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
export class LiveLineGuard {
  private confirmed = false

  apply(text: string, final: boolean): string | null {
    let line = guardLiveLine(text, final)
    if (line === null || !final) return line
    if (this.confirmed && line.trim() === DECLINE_LINE) line = SIGNOFF_LINE
    if (CALLBACK_STATEMENT.test(line) && !/would you mind/i.test(line)) this.confirmed = true
    return line
  }
}
