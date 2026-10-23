/**
 * LiveCoach lifecycle. Adapted from call-coach-hsl's tests/unit/realtime-coach-lifecycle.test.ts.
 * Sessions end at the gateway's 25-minute limit (or on a network drop) mid-call; the coach must
 * reconnect with a fresh token and hand the new session the call so far.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveCoach } from '@/services/realtime-coach'

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  readyState = 0
  sent: any[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string, public protocols: string[]) { FakeWS.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  // test helpers
  open() { this.readyState = FakeWS.OPEN; this.onopen?.() }
  event(e: object) { this.onmessage?.({ data: JSON.stringify(e) }) }
  drop(code = 1001) { this.readyState = 3; this.onclose?.({ code, reason: 'session limit' }) }
}

// Microtasks only: start() awaits getToken(). A setTimeout here would never fire under fake timers.
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('LiveCoach lifecycle', () => {
  const realWS = globalThis.WebSocket
  beforeEach(() => { FakeWS.instances = []; (globalThis as any).WebSocket = FakeWS })
  afterEach(() => { (globalThis as any).WebSocket = realWS; vi.useRealTimers() })

  async function liveCoach() {
    const events: any[] = []
    // The backend hands out the session URL with the token; there is no built-in one.
    const getToken = vi.fn(async () => ({ token: 'vcst_test', url: 'wss://gateway.example/session' }))
    const coach = new LiveCoach((m) => events.push(m), getToken)
    await coach.start()
    FakeWS.instances[0].open()
    return { coach, events, getToken, ws: FakeWS.instances[0] }
  }

  it('connects with the token as a subprotocol and configures the session first', async () => {
    const { ws, getToken, coach, events } = await liveCoach()
    expect(getToken).toHaveBeenCalledOnce()
    expect(ws.protocols).toEqual(['ai-gateway-realtime.v1', 'ai-gateway-auth.vcst_test'])
    expect(ws.url).toBe('wss://gateway.example/session')
    expect(ws.sent[0].type).toBe('session-update')
    expect(ws.sent[0].config.outputModalities).toEqual(['text'])
    expect(coach.isLive()).toBe(true)
    expect(events.filter((e) => e.type === 'LIVE_COACH_STATUS').map((e) => e.status)).toEqual(['connecting', 'live'])
  })

  it('sends what the agent said as a labelled context note', async () => {
    const { coach, ws } = await liveCoach()
    coach.noteAgent('Do you have a website right now?')
    const note = ws.sent.find((e) => e.type === 'conversation-item-create')
    expect(note.item).toMatchObject({ type: 'text-message', role: 'user' })
    expect(note.item.text).toMatch(/Context note, not the lead speaking.*Do you have a website right now\?/)
  })

  it('reconnects after an unexpected close and replays the call so far', async () => {
    vi.useFakeTimers()
    const { coach, ws, getToken } = await liveCoach()
    ws.event({ type: 'input-transcription-completed', transcript: 'We just opened in March.' })
    coach.noteAgent('Do you have a website right now?')

    ws.drop() // the 25-minute limit
    await vi.advanceTimersByTimeAsync(600)
    await flush()

    expect(getToken).toHaveBeenCalledTimes(2) // a fresh single-use token
    const ws2 = FakeWS.instances[1]
    expect(ws2).toBeDefined()
    ws2.open()
    expect(ws2.sent[0].type).toBe('session-update')
    const replay = ws2.sent.find((e) => e.type === 'conversation-item-create')
    expect(replay.item.text).toContain('Lead: We just opened in March.')
    expect(replay.item.text).toContain('Agent: Do you have a website right now?')
    expect(replay.item.text).toMatch(/^\(Context note, not the lead speaking/)
  })

  // A browser fires `error` right before `close` on a network drop. That must not end the session
  // (realtime-auto falls back on an 'error' status) before onclose can reconnect.
  it('reconnects after a network drop that fires error before close', async () => {
    vi.useFakeTimers()
    const { ws, events } = await liveCoach()
    ws.onerror?.()
    ws.event({ type: 'error', error: { message: 'transient' } })
    expect(events.some((e) => e.type === 'LIVE_COACH_STATUS' && e.status === 'error')).toBe(false)
    ws.drop(1006)
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    expect(FakeWS.instances).toHaveLength(2)
  })

  it('does not reconnect after stop(), and gives up after five drops', async () => {
    vi.useFakeTimers()
    const { coach, events } = await liveCoach()
    coach.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWS.instances).toHaveLength(1)
    expect(coach.isLive()).toBe(false)
    expect(events.some((e) => e.type === 'LIVE_COACH_STATUS' && e.status === 'off')).toBe(true)

    FakeWS.instances = []
    const second = await liveCoach()
    let current = second.ws
    for (let i = 0; i < 5; i++) {
      current.drop()
      await vi.advanceTimersByTimeAsync(600)
      await flush()
      current = FakeWS.instances[FakeWS.instances.length - 1]
      current.open()
    }
    current.drop() // sixth drop
    await vi.advanceTimersByTimeAsync(600)
    expect(FakeWS.instances).toHaveLength(6) // the original + five reconnects, no seventh
    expect(second.events.some((e) => e.type === 'LIVE_COACH_STATUS' && e.status === 'error')).toBe(true)
  })

  it('drops a half-written line when the lead keeps talking, and finalizes a finished one', async () => {
    const { ws, events } = await liveCoach()
    ws.event({ type: 'text-delta', delta: 'Do you have a ' })
    await flush()
    ws.event({ type: 'speech-started' })
    await flush()
    expect(events.filter((e) => e.type === 'LIVE_COACH_TIP_DROPPED')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'LIVE_COACH_TIP' && e.final)).toHaveLength(0)

    ws.event({ type: 'text-delta', delta: 'Do you have a website?' })
    await flush()
    ws.event({ type: 'text-done' })
    await flush()
    const tips = events.filter((e) => e.type === 'LIVE_COACH_TIP')
    expect(tips.at(-1)).toEqual({ type: 'LIVE_COACH_TIP', text: 'Do you have a website?', final: true })
    // the dropped draft did not leak into the next line
    expect(tips.every((t) => !t.text.includes('Do you have a Do you'))).toBe(true)
  })

  it('emits a running cost on each response-done', async () => {
    const { ws, events } = await liveCoach()
    const usage = { output_tokens: 26, input_token_details: { text_tokens: 33, audio_tokens: 54 } }
    ws.event({ type: 'response-done', raw: { response: { usage } } })
    await flush()
    ws.event({ type: 'response-done', raw: { usage } })
    await flush()
    const costs = events.filter((e) => e.type === 'LIVE_COACH_USAGE').map((e) => e.costUsd)
    expect(costs).toHaveLength(2)
    expect(costs[0]).toBeCloseTo(0.0006222, 7)
    expect(costs[1]).toBeCloseTo(0.0012444, 7)
  })

  it('reports an error and opens nothing when the token comes without a session url', async () => {
    const events: any[] = []
    const getToken = vi.fn(async () => ({ token: 'vcst_test', url: '' }))
    const coach = new LiveCoach((m) => events.push(m), getToken)
    await coach.start()
    expect(FakeWS.instances).toHaveLength(0)
    expect(coach.isLive()).toBe(false)
    expect(events.filter((e) => e.type === 'LIVE_COACH_STATUS')).toEqual([
      { type: 'LIVE_COACH_STATUS', status: 'connecting', detail: undefined },
      { type: 'LIVE_COACH_STATUS', status: 'error', detail: 'no session url' },
    ])
  })
})
