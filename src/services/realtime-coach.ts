/**
 * The live coach (v3): a realtime model listens to the lead and writes the agent's next line as
 * they speak. Ported from call-coach-hsl's RealtimeMiniCoach (v3.0.0), without the sandbox and
 * local token minting: the backend issues every token and the session URL, so neither the gateway
 * key nor the model id ships in the extension.
 *
 *   - TEXT-ONLY replies (`outputModalities: ['text']`); nothing is spoken.
 *   - Turn detection is server VAD with a 600 ms pause. HSL measured semantic VAD replying 7.2 s
 *     after the caller stopped, server VAD 1.5 s.
 *   - Billed per token. Every reply re-reads the conversation so far (cached tokens are cheaper),
 *     so the cost per minute rises as a call gets longer. The running cost is an estimate from the
 *     usage on each response.
 *
 * Gateway normalized realtime protocol: subprotocols `ai-gateway-realtime.v1` +
 * `ai-gateway-auth.<token>`, first frame must be `session-update`. Sessions end after 25 minutes;
 * an unexpected close reconnects with a fresh token and replays the call so far.
 */
import { buildInstructions } from '../../infra/lib/experiments/live-coach-instructions'
import { costOfUsage } from '../../infra/lib/experiments/realtime-pricing'
import { Upsample16to24, toBase64, type LiveCoachStatus } from './realtime-audio'

/** A single-use session token and the URL to open it on, both from the backend. */
export type SessionToken = { token: string; url: string }

export { costOfUsage }

const MAX_RECONNECTS = 5
const REPLAY_CHARS = 2000

type Turn = { speaker: 'lead' | 'agent'; text: string }

/** A context note goes in as a user-role text item (the only kind the protocol accepts). */
export function contextNote(text: string): string {
  return `(Context note, not the lead speaking. Do not reply to this note. ${text})`
}

/** The recent conversation, newest last, cut to fit one note. */
export function replayText(turns: Turn[], maxChars = REPLAY_CHARS): string {
  let out = ''
  for (let i = turns.length - 1; i >= 0; i--) {
    const line = `${turns[i].speaker === 'lead' ? 'Lead' : 'Agent'}: ${turns[i].text}\n`
    if (out.length + line.length > maxChars) break
    out = line + out
  }
  return out
}

export class LiveCoach {
  private ws: WebSocket | null = null
  private started = false
  private closing = false
  private line = ''
  private up = new Upsample16to24()
  private costUsd = 0
  private startedAt = 0
  private audioSent = false
  private reconnects = 0
  private turns: Turn[] = []

  constructor(
    private emit: (message: Record<string, unknown>) => void,
    private getToken: () => Promise<SessionToken>,
  ) {}

  async start(): Promise<void> {
    this.closing = false
    this.status('connecting')
    try {
      const { token, url } = await this.getToken()
      if (!url) throw new Error('no session url')
      if (this.closing) return
      const ws = new WebSocket(url, ['ai-gateway-realtime.v1', `ai-gateway-auth.${token}`])
      this.ws = ws
      ws.onopen = () => {
        this.send({
          type: 'session-update',
          config: {
            instructions: buildInstructions(),
            outputModalities: ['text'],
            inputAudioFormat: { type: 'audio/pcm', rate: 24000 },
            inputAudioTranscription: {},
            turnDetection: { type: 'server-vad', silenceDurationMs: 600 },
          },
        })
        this.started = true
        if (!this.startedAt) this.startedAt = Date.now()
        this.status('live')
        // A reconnected session starts blank: hand it the call so far.
        if (this.turns.length) {
          this.send({
            type: 'conversation-item-create',
            item: { type: 'text-message', role: 'user', text: contextNote(`The call so far, most recent last:\n${replayText(this.turns)}Continue the call from here.`) },
          })
          this.trace(`context replayed (${this.turns.length} turns)`)
        }
      }
      ws.onmessage = async (e) => {
        try {
          // Text frames arrive as strings; binary frames as Blobs in a browser.
          const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text()
          this.onEvent(JSON.parse(text))
        } catch {
          this.trace('unreadable frame')
        }
      }
      ws.onerror = () => this.status('error', 'socket error')
      ws.onclose = (e) => {
        this.trace(`socket closed ${e.code}${e.reason ? ` ${e.reason}` : ''}`)
        const wasStarted = this.started
        this.started = false
        this.ws = null
        if (this.closing) return this.status('off')
        if (wasStarted && this.reconnects < MAX_RECONNECTS) {
          this.reconnects++
          this.flushLine()
          this.trace(`reconnecting (${this.reconnects}/${MAX_RECONNECTS})`)
          setTimeout(() => this.start(), 500)
        } else {
          this.status('error', `session closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`)
        }
      }
    } catch (err: any) {
      this.status('error', err?.message || String(err))
    }
  }

  isLive(): boolean {
    return this.started && !this.closing
  }

  appendLeadAudio(chunk: Int16Array): void {
    if (!this.started || this.closing) return
    const pcm = this.up.convert(chunk)
    if (!pcm.length) return
    if (!this.audioSent) this.trace('lead audio flowing')
    this.audioSent = true
    this.send({ type: 'input-audio-append', audio: toBase64(pcm) })
  }

  /**
   * What the agent actually said (Deepgram finals). Kept for replay, and sent now as context: the
   * model hears only the lead, so this is how it knows what was asked.
   */
  noteAgent(text: string): void {
    const t = text.trim()
    if (!t) return
    this.remember('agent', t)
    if (this.started) {
      this.send({
        type: 'conversation-item-create',
        item: { type: 'text-message', role: 'user', text: contextNote(`The agent just said: "${t}"`) },
      })
    }
  }

  stop(): void {
    this.closing = true
    this.flushLine()
    if (this.ws) this.ws.close()
    else this.status('off')
  }

  private onEvent(event: any): void {
    switch (event?.type) {
      case 'text-delta':
        this.line += event.delta || ''
        this.emit({ type: 'LIVE_COACH_TIP', text: this.line.trim(), final: false })
        break
      case 'text-done':
        if (!this.line && event.text) this.line = event.text
        this.trace(this.line ? 'reply done' : 'reply done (empty)')
        this.flushLine()
        break
      case 'speech-started':
        // The lead started talking again while a line was still being written: it answered a
        // pause, not a finished turn, so it is dropped rather than shown half-done. The model
        // replies again when they finish.
        if (this.line) {
          this.trace(`line dropped, lead kept talking: "${this.line.trim().slice(0, 40)}"`)
          this.line = ''
          this.emit({ type: 'LIVE_COACH_TIP_DROPPED' })
        }
        this.trace('speech detected')
        break
      case 'speech-stopped':
        this.trace('speech ended')
        break
      case 'session-updated':
        this.trace('session configured')
        break
      case 'input-transcription-completed':
        if (event.transcript) this.remember('lead', event.transcript)
        break
      case 'response-done': {
        const usage = event.raw?.response?.usage || event.raw?.usage
        this.costUsd += costOfUsage(usage)
        this.emit({ type: 'LIVE_COACH_USAGE', seconds: (Date.now() - this.startedAt) / 1000, costUsd: this.costUsd })
        break
      }
      case 'error': {
        const msg = event.error?.message || event.message || JSON.stringify(event).slice(0, 160)
        this.trace(`error: ${msg}`)
        this.status('error', msg)
        break
      }
    }
  }

  private trace(text: string): void {
    this.emit({ type: 'LIVE_COACH_TRACE', text })
  }

  private flushLine(): void {
    const text = this.line.trim()
    this.line = ''
    if (!text) return
    // noteAgent() records what the agent actually said; the suggestion is kept too, as context.
    this.remember('agent', text)
    this.emit({ type: 'LIVE_COACH_TIP', text, final: true })
  }

  private remember(speaker: Turn['speaker'], text: string): void {
    this.turns.push({ speaker, text })
    if (this.turns.length > 60) this.turns.shift()
  }

  private status(status: LiveCoachStatus, detail?: string): void {
    this.emit({ type: 'LIVE_COACH_STATUS', status, detail })
  }

  private send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }
}
