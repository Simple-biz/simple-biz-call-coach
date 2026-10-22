/**
 * The live coach on a real call. Adapted from call-coach-hsl's tests/unit/realtime-auto.test.ts.
 * The rules that keep it safe: no token → nothing starts (the call stays on today's coach); a
 * refusal is final; a token that arrives after the call ended never opens a session. SBCC adds:
 * the session opens on the lead's first words (armed at call start), the lead's opening audio is
 * kept as pre-roll, and every line passes the price and script guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PRICING_REDIRECT } from '@infra/lib/lambda/shared/price-guard'

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
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
  open() { this.readyState = FakeWS.OPEN; this.onopen?.() }
  event(e: object) { this.onmessage?.({ data: JSON.stringify(e) }) }
  drop(code = 1001) { this.readyState = 3; this.onclose?.({ code, reason: '' }) }
}

const sendMessage = vi.fn()
const realWS = globalThis.WebSocket
const realSendMessage = (globalThis as any).chrome.runtime.sendMessage
let mod: typeof import('@/offscreen/realtime-auto') | null = null

beforeEach(() => {
  // A developer's .env.local may hold VITE_EXPERIMENTS and a gateway key for a local test build;
  // these tests cover the backend token path and must never mint a real token.
  vi.stubEnv('VITE_EXPERIMENTS', 'false')
  vi.stubEnv('VITE_AI_GATEWAY_API_KEY', '')
  vi.resetModules()
  FakeWS.instances = []
  sendMessage.mockReset()
  ;(globalThis as any).WebSocket = FakeWS
  ;(globalThis as any).chrome.runtime.sendMessage = sendMessage
})
afterEach(() => {
  mod?.stopRealtimeAuto()
  mod = null
  ;(globalThis as any).WebSocket = realWS
  ;(globalThis as any).chrome.runtime.sendMessage = realSendMessage
})

const load = async () => (mod = await import('@/offscreen/realtime-auto'))
const noWait = async () => {}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

const TOKEN = { token: 'vcst_live', url: 'wss://gateway.example/session' }
const grantToken = () => sendMessage.mockImplementation(async (m: any) =>
  m.type === 'GET_REALTIME_TOKEN' ? { success: true, result: TOKEN } : undefined)
const sentOf = (type: string) => sendMessage.mock.calls.map(([m]) => m).filter((m) => m.type === type)
const tokenRequests = () => sentOf('GET_REALTIME_TOKEN').length

function decode(b64: string): Int16Array {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Int16Array(bytes.buffer)
}
const filled = (n: number, v: number) => new Int16Array(n).fill(v)

describe('firstTokenWithRetry', () => {
  it('retries while the backend is still coming up, then succeeds', async () => {
    const { firstTokenWithRetry } = await load()
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('realtime token: backend not connected'))
      .mockRejectedValueOnce(new Error('realtime token refused: no-agent'))
      .mockResolvedValueOnce(TOKEN)
    await expect(firstTokenWithRetry(request, noWait)).resolves.toBe(TOKEN)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('treats not-enabled as final: one request, no retries', async () => {
    const { firstTokenWithRetry } = await load()
    const request = vi.fn().mockRejectedValue(new Error('realtime token refused: not-enabled'))
    await expect(firstTokenWithRetry(request, noWait)).rejects.toThrow('not-enabled')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("treats 'not-configured' as final too", async () => {
    const { firstTokenWithRetry } = await load()
    const request = vi.fn().mockRejectedValue(new Error('realtime token refused: not-configured'))
    await expect(firstTokenWithRetry(request, noWait)).rejects.toThrow('not-configured')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last retry', async () => {
    const { firstTokenWithRetry } = await load()
    const request = vi.fn().mockRejectedValue(new Error('realtime token: request timed out'))
    await expect(firstTokenWithRetry(request, noWait)).rejects.toThrow('timed out')
    expect(request).toHaveBeenCalledTimes(4)
  })
})

describe('startRealtimeAuto', () => {
  it('opens nothing when the backend refuses (the default, off-pilot)', async () => {
    sendMessage.mockImplementation(async (m: any) =>
      m.type === 'GET_REALTIME_TOKEN' ? { success: true, result: { error: 'realtime token refused: not-enabled' } } : undefined)
    const { startRealtimeAuto, isRealtimeAutoActive } = await load()
    await startRealtimeAuto()
    expect(FakeWS.instances).toHaveLength(0)
    expect(isRealtimeAutoActive()).toBe(false)
    // the panel is told the live coach is unavailable, so it brings back the manual controls
    expect(sentOf('REALTIME_STATUS')).toEqual([{ type: 'REALTIME_STATUS', status: 'off', detail: 'unavailable' }])
  })

  it('opens a session with the backend token and forwards its lines to the side panel', async () => {
    grantToken()
    const { startRealtimeAuto, isRealtimeAutoActive, stopRealtimeAuto } = await load()
    await startRealtimeAuto()
    expect(isRealtimeAutoActive()).toBe(true)
    const ws = FakeWS.instances[0]
    expect(ws.protocols).toContain('ai-gateway-auth.vcst_live')
    expect(ws.url).toBe('wss://gateway.example/session') // the URL the backend sent, not a built-in one
    ws.open()
    ws.event({ type: 'text-delta', delta: 'Do you have a website right now?' })
    await flush()
    ws.event({ type: 'text-done' })
    await flush()
    expect(sentOf('REALTIME_TIP').at(-1)).toMatchObject({ text: 'Do you have a website right now?', final: true })
    expect(sentOf('REALTIME_STATUS').some((m) => m.status === 'live')).toBe(true)

    stopRealtimeAuto()
    expect(isRealtimeAutoActive()).toBe(false)
    expect(sentOf('REALTIME_STATUS').at(-1)).toEqual({ type: 'REALTIME_STATUS', status: 'off', detail: 'call ended' })
  })

  it('never opens a session for a call that ended while the token was pending', async () => {
    let release: (v: any) => void = () => {}
    sendMessage.mockImplementation((m: any) =>
      m.type === 'GET_REALTIME_TOKEN' ? new Promise((r) => { release = r }) : Promise.resolve())
    const { startRealtimeAuto, stopRealtimeAuto, isRealtimeAutoActive } = await load()
    const starting = startRealtimeAuto()
    stopRealtimeAuto() // the call ends first
    release({ success: true, result: TOKEN })
    await starting
    expect(FakeWS.instances).toHaveLength(0)
    expect(isRealtimeAutoActive()).toBe(false)
  })
})

describe('armed until the lead speaks', () => {
  it('requests no token while armed and only hearing lead audio', async () => {
    grantToken()
    const { armRealtimeAuto, realtimeLeadAudio, isRealtimeAutoActive } = await load()
    armRealtimeAuto()
    realtimeLeadAudio(filled(1600, 100))
    realtimeLeadAudio(filled(1600, 200))
    await flush()
    expect(tokenRequests()).toBe(0)
    expect(FakeWS.instances).toHaveLength(0)
    expect(isRealtimeAutoActive()).toBe(false)
  })

  it('does nothing when the lead speaks on a call that was never armed', async () => {
    grantToken()
    const { realtimeLeadSpoke } = await load()
    realtimeLeadSpoke()
    await flush()
    expect(tokenRequests()).toBe(0)
  })

  it('opens one session however often the lead speaks', async () => {
    grantToken()
    const { armRealtimeAuto, realtimeLeadSpoke, isRealtimeAutoActive } = await load()
    armRealtimeAuto()
    realtimeLeadSpoke()
    realtimeLeadSpoke()
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1))
    realtimeLeadSpoke()
    await flush()
    expect(tokenRequests()).toBe(1)
    expect(FakeWS.instances).toHaveLength(1)
    expect(isRealtimeAutoActive()).toBe(true)
  })

  it('appends the pre-roll in order once the session is live, then streams directly', async () => {
    let release: (v: any) => void = () => {}
    sendMessage.mockImplementation((m: any) =>
      m.type === 'GET_REALTIME_TOKEN' ? new Promise((r) => { release = r }) : Promise.resolve())
    const { armRealtimeAuto, realtimeLeadSpoke, realtimeLeadAudio } = await load()
    armRealtimeAuto()
    realtimeLeadAudio(filled(1600, 100)) // armed
    realtimeLeadSpoke()
    realtimeLeadAudio(filled(1600, 200)) // waiting on the token
    release({ success: true, result: TOKEN })
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1))
    realtimeLeadAudio(filled(1600, 300)) // socket connecting
    const ws = FakeWS.instances[0]
    expect(ws.sent).toHaveLength(0)

    ws.open()
    const appended = () => ws.sent.filter((e) => e.type === 'input-audio-append').map((e) => decode(e.audio))
    expect(ws.sent[0].type).toBe('session-update') // configured before any audio
    expect(appended().map((pcm) => pcm[pcm.length - 1])).toEqual([100, 200, 300])

    realtimeLeadAudio(filled(1600, 400)) // live: straight through, no buffering
    expect(appended().map((pcm) => pcm[pcm.length - 1])).toEqual([100, 200, 300, 400])
  })

  it('keeps only the last ~3 s (48,000 samples) of pre-roll', async () => {
    let release: (v: any) => void = () => {}
    sendMessage.mockImplementation((m: any) =>
      m.type === 'GET_REALTIME_TOKEN' ? new Promise((r) => { release = r }) : Promise.resolve())
    const { armRealtimeAuto, realtimeLeadSpoke, realtimeLeadAudio } = await load()
    armRealtimeAuto()
    // 10 chunks of 0.5 s = 5 s of audio; only the last 3 s (6 chunks) are kept
    for (let i = 1; i <= 10; i++) realtimeLeadAudio(filled(8000, i * 10))
    realtimeLeadSpoke()
    release({ success: true, result: TOKEN })
    await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(1))
    const ws = FakeWS.instances[0]
    ws.open()
    const appended = ws.sent.filter((e) => e.type === 'input-audio-append').map((e) => decode(e.audio))
    expect(appended.map((pcm) => pcm[pcm.length - 1])).toEqual([50, 60, 70, 80, 90, 100])
    const samples24k = appended.reduce((n, pcm) => n + pcm.length, 0)
    expect(samples24k).toBeLessThanOrEqual(48000 * 1.5 + 2)
  })

  it('discards the pre-roll when the token is refused', async () => {
    sendMessage.mockImplementation(async (m: any) =>
      m.type === 'GET_REALTIME_TOKEN' ? { success: true, result: { error: 'realtime token refused: not-enabled' } } : undefined)
    const { armRealtimeAuto, realtimeLeadSpoke, realtimeLeadAudio, startRealtimeAuto } = await load()
    armRealtimeAuto()
    realtimeLeadAudio(filled(1600, 100))
    realtimeLeadSpoke()
    await vi.waitFor(() => expect(sentOf('REALTIME_STATUS')).toHaveLength(1))
    expect(sentOf('REALTIME_STATUS')[0]).toEqual({ type: 'REALTIME_STATUS', status: 'off', detail: 'unavailable' })
    expect(tokenRequests()).toBe(1) // final refusal: no retry

    // no longer armed: the lead speaking again does not ask again
    realtimeLeadSpoke()
    await flush()
    expect(tokenRequests()).toBe(1)

    // and a later session (e.g. a manual start) does not get the old call's audio
    grantToken()
    await startRealtimeAuto()
    const ws = FakeWS.instances[0]
    ws.open()
    expect(ws.sent.filter((e) => e.type === 'input-audio-append')).toHaveLength(0)
  })
})

describe('guards on live lines', () => {
  async function liveSession() {
    grantToken()
    const m = await load()
    await m.startRealtimeAuto()
    const ws = FakeWS.instances[0]
    ws.open()
    sendMessage.mockClear()
    grantToken()
    return { ws, ...m }
  }

  it('holds back a draft quoting a price and replaces the final line with the pricing redirect', async () => {
    const { ws } = await liveSession()
    ws.event({ type: 'text-delta', delta: 'Most sites run about $500 a month.' })
    await flush()
    expect(sentOf('REALTIME_TIP')).toHaveLength(0) // the draft is not streamed
    ws.event({ type: 'text-done' })
    await flush()
    expect(sentOf('REALTIME_TIP')).toEqual([{ type: 'REALTIME_TIP', text: PRICING_REDIRECT, final: true }])
  })

  it('adds "or his partner" to a callback offer', async () => {
    const { ws } = await liveSession()
    ws.event({ type: 'text-delta', delta: 'Would you mind if I have Bob call you?' })
    await flush()
    ws.event({ type: 'text-done' })
    await flush()
    expect(sentOf('REALTIME_TIP').at(-1)).toEqual({ type: 'REALTIME_TIP', text: 'Would you mind if I have Bob or his partner call you?', final: true })
  })

  it('forwards a dropped draft and the agent\'s words', async () => {
    const { ws, realtimeNoteAgent } = await liveSession()
    ws.event({ type: 'text-delta', delta: 'Do you have a' })
    await flush()
    ws.event({ type: 'speech-started' })
    await flush()
    expect(sentOf('REALTIME_TIP_DROPPED')).toHaveLength(1)

    realtimeNoteAgent('Do you have a website right now?')
    const note = ws.sent.filter((e) => e.type === 'conversation-item-create').at(-1)
    expect(note.item.text).toContain('The agent just said: "Do you have a website right now?"')
  })

  it('keeps the session through a server error event (only a close ends it)', async () => {
    const { ws, isRealtimeAutoActive } = await liveSession()
    ws.event({ type: 'error', error: { message: 'boom' } })
    await flush()
    expect(isRealtimeAutoActive()).toBe(true)
    expect(sentOf('REALTIME_STATUS').some((m) => m.detail === 'fallback')).toBe(false)
  })

  it('falls back to today\'s coach when the session closes before it ever opens', async () => {
    grantToken()
    const { startRealtimeAuto, isRealtimeAutoActive } = await load()
    await startRealtimeAuto()
    FakeWS.instances[0].drop(1006)
    await flush()
    expect(isRealtimeAutoActive()).toBe(false)
    expect(sentOf('REALTIME_STATUS').at(-1)).toEqual({ type: 'REALTIME_STATUS', status: 'off', detail: 'fallback' })
  })
})

// Kayser, 2026-10-23: a "hmm" from the lead while he was reading replaced the line under him.
describe('lines while the agent is reading', () => {
  async function liveSession() {
    grantToken()
    const m = await load()
    await m.startRealtimeAuto()
    const ws = FakeWS.instances[0]
    ws.open()
    sendMessage.mockClear()
    grantToken()
    return { ws, ...m }
  }
  const line = async (ws: FakeWS, text: string) => {
    ws.event({ type: 'text-delta', delta: text })
    await flush()
    ws.event({ type: 'text-done' })
    await flush()
  }

  afterEach(() => { vi.useRealTimers() })

  it('drops the reply to a backchannel and keeps the line on screen', async () => {
    vi.useFakeTimers()
    const { ws, realtimeAgentSpoke } = await liveSession()
    realtimeAgentSpoke() // reading the opener
    ws.event({ type: 'speech-started' }) // "Mhm."
    vi.advanceTimersByTime(800)
    realtimeAgentSpoke()
    ws.event({ type: 'speech-stopped' })
    await line(ws, 'Would you mind if I have Bob or his partner give you a call?')
    vi.advanceTimersByTime(5000)
    await flush()
    expect(sentOf('REALTIME_TIP')).toHaveLength(0)
  })

  it('holds the reply to an interruption until the agent stops, then shows it', async () => {
    vi.useFakeTimers()
    const { ws, realtimeAgentSpoke } = await liveSession()
    realtimeAgentSpoke()
    ws.event({ type: 'speech-started' }) // "Wait, is this a real person or a robot call?"
    vi.advanceTimersByTime(2500)
    realtimeAgentSpoke()
    ws.event({ type: 'speech-stopped' })
    await line(ws, "Yes, I'm a real person. I'm Bob's assistant. Are you the one who handles the website?")
    expect(sentOf('REALTIME_TIP')).toHaveLength(0)
    vi.advanceTimersByTime(1600)
    await flush()
    expect(sentOf('REALTIME_TIP')).toEqual([
      { type: 'REALTIME_TIP', text: "Yes, I'm a real person. I'm Bob's assistant. Are you the one who handles the website?", final: true },
    ])
  })

  it('shows a reply at once when the agent was quiet (an "mhm" that answers)', async () => {
    const { ws } = await liveSession()
    ws.event({ type: 'speech-started' })
    ws.event({ type: 'speech-stopped' })
    await line(ws, 'Can I have your first name, please?')
    expect(sentOf('REALTIME_TIP').at(-1)).toMatchObject({ text: 'Can I have your first name, please?', final: true })
  })
})
