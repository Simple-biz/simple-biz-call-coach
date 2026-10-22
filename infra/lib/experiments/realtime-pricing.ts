/**
 * Estimated cost of one live coach (OpenAI Realtime mini) response, from the `usage` block on its
 * `response-done` event. Copied from call-coach-hsl (v3). Used by src/services/realtime-coach.ts
 * for the per-call [RealtimeUsage] line, and by the lead-persona simulator.
 *
 * USD per token, from the AI Gateway model list (2026-10-02). Cached audio is billed at
 * OpenAI's cached-audio rate for mini ($0.30/M), which the gateway list does not show separately.
 */
export const REALTIME_MINI_PRICE = {
  audioIn: 0.00001,
  textIn: 0.0000006,
  cachedText: 0.00000006,
  cachedAudio: 0.0000003,
  textOut: 0.0000024,
}

export function costOfUsage(u: any): number {
  if (!u) return 0
  const p = REALTIME_MINI_PRICE
  const inD = u.input_token_details || {}
  const cached = inD.cached_tokens_details || {}
  const audioIn = (inD.audio_tokens || 0) - (cached.audio_tokens || 0)
  const textIn = (inD.text_tokens || 0) - (cached.text_tokens || 0)
  return (
    Math.max(0, audioIn) * p.audioIn +
    Math.max(0, textIn) * p.textIn +
    (cached.audio_tokens || 0) * p.cachedAudio +
    (cached.text_tokens || 0) * p.cachedText +
    (u.output_tokens || 0) * p.textOut
  )
}
