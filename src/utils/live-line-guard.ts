/**
 * The same code-level guards today's coach runs in parseAITipResponse (infra/lib/lambda/shared/
 * claude-client-optimized.ts), applied to the live coach's lines. Live lines go straight from the
 * gateway to the extension, so without this they would skip the backend's guards.
 *
 * fixWeakEnding is not applied: it needs the call stage, which only the backend knows, and after a
 * lead agrees a confirmation ending is correct.
 */
import { mentionsPrice, PRICING_REDIRECT } from '../../infra/lib/lambda/shared/price-guard'
import { claimsUnscriptedFact, addHisPartner, SCRIPT_DEFLECT } from '../../infra/lib/lambda/shared/script-guard'

/**
 * @returns the line to show, or null to hold a draft back (a half-written line that is already
 *   quoting a price or making an unscripted claim is not streamed; its final version is replaced).
 */
export function guardLiveLine(text: string, final: boolean): string | null {
  const offScript = mentionsPrice(text) ? PRICING_REDIRECT : claimsUnscriptedFact(text) ? SCRIPT_DEFLECT : null
  if (offScript) return final ? offScript : null
  return oneCallbackAsk(addHisPartner(text))
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
