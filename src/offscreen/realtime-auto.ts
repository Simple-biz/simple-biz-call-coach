/**
 * The live coach on a real call (v3). Ported from call-coach-hsl's realtime-auto.ts (v3.0.0).
 *
 * The offscreen document already has both sides of the call: the lead's audio (callerWorklet,
 * 16 kHz Int16) and the agent's Deepgram finals. This module feeds the lead's audio and the
 * agent's words to a LiveCoach and forwards its lines to the side panel as REALTIME_TIP.
 *
 * Differences from HSL:
 *   - The session opens on the lead's first words, not when the call starts: about 83% of Simple
 *     Biz conversations end under 30 seconds (dials, voicemails), and a session per dial would be
 *     paid for nothing. The call is ARMED at start; the last few seconds of lead audio are kept so
 *     the coach still hears the opening words once the session is live.
 *   - Every line passes the price and script guards before it is shown (live-line-guard.ts).
 *
 * It does NOTHING unless the backend hands out a token. A refusal ('not-enabled': agent not on
 * /call-coach/realtime-agents, 'not-configured': no gateway key) leaves the call on today's coach.
 * If the session dies for good mid-call, REALTIME_STATUS 'off' brings Get Next Suggestion back.
 */
import { logger } from '@/utils/logger'
import { LiveCoach, type SessionToken } from '@/services/realtime-coach'
import { LiveLineGuard, futureDateInsteadOfDecline } from '@/utils/live-line-guard'
import { DECLINE_LINE } from '../../infra/lib/experiments/live-coach-instructions'
import { LineGate } from '@/utils/line-gate'

let coach: LiveCoach | null = null
// When a new line may replace the one the agent is reading (line-gate.ts). One per call.
let gate = new LineGate()
let held: { text: string; final: boolean } | null = null
// What the lead said this turn (the session's own transcript), for futureDateInsteadOfDecline.
let leadTurnText = ''
const LEAD_TEXT_WAIT_MS = 1200
let releaseTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Shows the line held back while the agent was talking, once they stop, unless by then it turned
 * out the agent kept reading through a lead's "hmm" (the gate says drop).
 */
function scheduleRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (!held) return
    const verdict = gate.verdict()
    if (verdict === 'hold') return scheduleRelease()
    if (verdict === 'drop') logger.log(`🎙️ [LiveCoach] backchannel reply dropped: "${held.text.slice(0, 40)}"`)
    else send({ type: 'REALTIME_TIP', text: held.text, final: held.final })
    held = null
  }, gate.msUntilQuiet() + 50)
}
// armed: the call started, waiting for the lead's first words. starting: waiting on the token.
let armed = false
let starting = false

// Lead audio kept while armed or connecting, so the session hears the words that woke it.
const PRE_ROLL_SAMPLES = 16000 * 3
let preRoll: Int16Array[] = []
let preRollSamples = 0

function send(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

// Local test builds only (VITE_EXPERIMENTS=true): mint with the gateway key from .env.local, so the
// live coach can be tried on a real call before the backend token route is deployed. Both conditions
// are static, so a normal build drops the key and this path entirely.
const LOCAL_KEY =
  import.meta.env.VITE_EXPERIMENTS === 'true' ? ((import.meta.env.VITE_AI_GATEWAY_API_KEY as string | undefined) || '') : ''
const LOCAL_MODEL = 'openai/gpt-realtime-mini'

async function mintLocally(): Promise<SessionToken> {
  const res = await fetch('https://ai-gateway.vercel.sh/v1/realtime/client-secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOCAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_MODEL }),
  })
  if (!res.ok) throw new Error(`local token ${res.status}`)
  const token = (await res.json()).token
  return { token, url: `wss://ai-gateway.vercel.sh/v4/ai/realtime-model?ai-model-id=${encodeURIComponent(LOCAL_MODEL)}` }
}

async function requestToken(): Promise<SessionToken> {
  if (LOCAL_KEY) return mintLocally()
  // The background wraps handler results as { success, result }.
  const reply = await chrome.runtime.sendMessage({ type: 'GET_REALTIME_TOKEN' })
  const token = reply?.result?.token
  const url = reply?.result?.url
  if (!token || !url) throw new Error(reply?.result?.error || reply?.error || 'no token')
  return { token, url }
}

// Capture starts before the backend socket connects and registers the agent, so the first
// request can land too early. These are worth a retry; 'not-enabled' / 'not-configured' are not.
const RETRYABLE = /not connected|timed out|no-agent/
const FIRST_TOKEN_DELAYS_MS = [0, 1500, 3000, 5000]

export async function firstTokenWithRetry(
  request: () => Promise<SessionToken>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<SessionToken> {
  let lastErr: unknown
  for (const delay of FIRST_TOKEN_DELAYS_MS) {
    if (delay) await wait(delay)
    try {
      return await request()
    } catch (err: any) {
      lastErr = err
      if (!RETRYABLE.test(err?.message || '')) break
    }
  }
  throw lastErr
}

// Bumped by every stop: a start still waiting on its token must not open a session after the
// call it was for has ended.
let generation = 0

/** Call started: wait for the lead's first words before opening a session. */
export function armRealtimeAuto(): void {
  if (coach) return
  armed = true
  preRoll = []
  preRollSamples = 0
}

/** The lead said something (a Deepgram caller transcript with words): open the session. */
export function realtimeLeadSpoke(): void {
  if (!armed || starting || coach) return
  void startRealtimeAuto()
}

export async function startRealtimeAuto(getToken: () => Promise<SessionToken> = requestToken): Promise<void> {
  if (coach || starting) return
  const mine = ++generation
  starting = true
  let first: SessionToken
  try {
    first = await firstTokenWithRetry(getToken)
  } catch (err: any) {
    logger.log(`ℹ️ [LiveCoach] not starting (${err?.message || err}), today's coach stays on`)
    if (mine === generation) {
      starting = armed = false
      preRoll = []
      preRollSamples = 0
      send({ type: 'REALTIME_STATUS', status: 'off', detail: 'unavailable' })
    }
    return
  }
  if (mine !== generation) return // the call ended meanwhile; stop already reset the state
  starting = armed = false
  let firstUsed = false
  const guard = new LiveLineGuard()
  const instance = new LiveCoach(
    (msg) => {
      switch (msg.type) {
        case 'LIVE_COACH_TIP': {
          // Streamed word by word. A draft abandoned because the lead kept talking is withdrawn
          // with REALTIME_TIP_DROPPED; the panel then puts the last finished line back.
          const verdict = gate.verdict()
          if (verdict === 'drop') {
            // A reply to the lead's "hmm" while the agent was reading: the line on screen stays.
            // Not passed through the guard, so it doesn't count as an ask or a question asked.
            if (msg.final) logger.log(`🎙️ [LiveCoach] backchannel reply dropped: "${String(msg.text).slice(0, 40)}"`)
            break
          }
          const text = guard.apply(String(msg.text), !!msg.final)
          if (text === null) break
          // The decline line waits for the lead's words (they can land a few hundred ms after the
          // reply): a lead who named a later time gets the future-date line instead.
          if (msg.final && text.trim() === DECLINE_LINE && !leadTurnText) {
            const waitFrom = Date.now()
            const poll = () => {
              if (leadTurnText || Date.now() - waitFrom >= LEAD_TEXT_WAIT_MS) deliver(futureDateInsteadOfDecline(text, leadTurnText), true)
              else setTimeout(poll, 50)
            }
            poll()
            break
          }
          // A draft on its way to the decline line isn't streamed: it may turn into the future-date
          // line, and an agent shouldn't start saying goodbye off a half-written line.
          if (!msg.final && text.trim().length >= 10 && DECLINE_LINE.startsWith(text.trim())) break
          deliver(msg.final ? futureDateInsteadOfDecline(text, leadTurnText) : text, !!msg.final)
          break
        }
        case 'LIVE_COACH_LEAD':
          leadTurnText = String(msg.text)
          break
        case 'LIVE_COACH_TIP_DROPPED':
          held = null
          send({ type: 'REALTIME_TIP_DROPPED' })
          break
        case 'LIVE_COACH_SPEECH':
          if (msg.phase === 'started') {
            gate.leadStarted()
            leadTurnText = ''
            // A reply still waiting for the agent to stop answered something earlier; the lead is
            // saying more now and the coach will answer that. (Simulated calls: a held reply to a
            // "mhm" popped up just as the lead began their real answer.)
            held = null
          } else gate.leadStopped()
          break
        case 'LIVE_COACH_STATUS':
          send({ type: 'REALTIME_STATUS', status: msg.status, detail: msg.detail })
          if (msg.status === 'live') flushPreRoll(instance)
          // A dead session after the reconnects: hand the call back to today's coach.
          if (msg.status === 'error' && coach === instance) {
            logger.warn(`⚠️ [LiveCoach] session failed (${msg.detail}), falling back to today's coach`)
            coach = null
            instance.stop()
            send({ type: 'REALTIME_STATUS', status: 'off', detail: 'fallback' })
          }
          break
        case 'LIVE_COACH_USAGE':
          send({ type: 'REALTIME_USAGE', seconds: msg.seconds, costUsd: msg.costUsd })
          break
        case 'LIVE_COACH_TRACE':
          logger.log(`🎙️ [LiveCoach] ${msg.text}`)
          break
      }
    },
    async () => {
      if (!firstUsed) { firstUsed = true; return first }
      return getToken() // reconnects get a fresh single-use token
    },
  )
  coach = instance
  logger.log('🎙️ [LiveCoach] starting')
  await instance.start()
}

/** Shows a guarded line now, or holds it while the agent is reading (line-gate.ts). */
function deliver(text: string, final: boolean): void {
  if (gate.verdict() === 'hold') {
    held = { text, final }
    scheduleRelease()
    return
  }
  send({ type: 'REALTIME_TIP', text, final })
}

function flushPreRoll(instance: LiveCoach): void {
  for (const chunk of preRoll) instance.appendLeadAudio(chunk)
  preRoll = []
  preRollSamples = 0
}

/** Lead-side audio from callerWorklet (Int16, 16 kHz). */
export function realtimeLeadAudio(chunk: Int16Array): void {
  if (coach?.isLive()) {
    coach.appendLeadAudio(chunk)
    return
  }
  if (!armed && !starting && !coach) return
  preRoll.push(chunk)
  preRollSamples += chunk.length
  while (preRollSamples > PRE_ROLL_SAMPLES && preRoll.length > 1) {
    preRollSamples -= preRoll.shift()!.length
  }
}

/** A final transcript of the agent, so the model knows what was actually said. */
export function realtimeNoteAgent(text: string): void {
  coach?.noteAgent(text)
}

/** Any agent transcript, interim or final: the agent is talking (reading a line). */
export function realtimeAgentSpoke(): void {
  gate.agentSpoke()
}

export function stopRealtimeAuto(): void {
  generation++ // cancels a start still waiting on its token
  armed = starting = false
  preRoll = []
  preRollSamples = 0
  gate = new LineGate()
  held = null
  leadTurnText = ''
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
  if (!coach) return
  coach.stop()
  coach = null
  send({ type: 'REALTIME_STATUS', status: 'off', detail: 'call ended' })
}

export function isRealtimeAutoActive(): boolean {
  return coach !== null
}
