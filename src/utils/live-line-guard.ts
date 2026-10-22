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
  return addHisPartner(text)
}
