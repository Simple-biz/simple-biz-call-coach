/**
 * Kayser, 2026-10-23, after the gate dropped a pitch: "retest again a lot to see if this can still
 * happen, we can't miss like that". Thousands of random timings through LineGate, the way
 * realtime-auto drives it: the agent reads a line (transcripts every 250 ms, arriving late), the
 * lead answers around the end of it or says "mhm" in the middle, and the coach's reply arrives
 * 0.8-1.8 s after the lead stops. A real answer must never be dropped; a "mhm" with the agent
 * reading on must never replace the line.
 */
import { describe, it, expect } from 'vitest'
import { LineGate } from '@/utils/line-gate'

// Seeded so a failure can be replayed.
function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}
const between = (r: () => number, a: number, b: number) => a + r() * (b - a)

/** Runs one scenario; returns the gate's final verdict for the reply ('show' or 'drop'). */
function run(opts: {
  readMs: number; lagMs: number; leadStartMs: number; leadMs: number; replyDelayMs: number
}): 'show' | 'drop' {
  let t = 0
  const g = new LineGate(() => t)
  const agentTicks: number[] = []
  for (let at = opts.lagMs; at <= opts.readMs + opts.lagMs; at += 250) agentTicks.push(at)
  const events: Array<[number, () => void]> = [
    ...agentTicks.map((at) => [at, () => g.agentSpoke()] as [number, () => void]),
    [opts.leadStartMs, () => g.leadStarted()],
    [opts.leadStartMs + opts.leadMs, () => g.leadStopped()],
  ]
  events.sort((a, b) => a[0] - b[0])
  const replyAt = opts.leadStartMs + opts.leadMs + opts.replyDelayMs
  for (const [at, fn] of events) { if (at > replyAt) break; t = at; fn() }
  // From the reply on: realtime-auto holds it and re-asks the gate as time passes.
  let next = events.findIndex(([at]) => at > replyAt)
  for (t = replyAt; t < replyAt + 20_000; t += 50) {
    while (next >= 0 && next < events.length && events[next][0] <= t) { events[next][1](); next++ }
    const v = g.verdict()
    if (v !== 'hold') return v
  }
  throw new Error('held forever')
}

describe('LineGate under random timings', () => {
  it('never drops a real answer (the lead answering around the end of the agent\'s line)', () => {
    const r = rng(20261023)
    let held = 0
    for (let i = 0; i < 5000; i++) {
      const readMs = between(r, 800, 12000)
      const s = {
        readMs,
        lagMs: between(r, 200, 1200), // Deepgram transcripts reach the extension this late
        leadStartMs: readMs + between(r, -300, 800), // a quick answer can clip the agent's last word
        leadMs: between(r, 400, 3000),
        replyDelayMs: between(r, 800, 1800),
      }
      const v = run(s)
      if (v !== 'show') throw new Error(`answer dropped: ${JSON.stringify(s)}`)
      held++
    }
    expect(held).toBe(5000)
  })

  it('drops a "mhm" said in the middle of the agent\'s line while the agent reads on', () => {
    const r = rng(42)
    for (let i = 0; i < 5000; i++) {
      const readMs = between(r, 6000, 14000)
      const leadStartMs = between(r, 1500, readMs - 3000) // at least 3 s of the line still to read
      const s = { readMs, lagMs: between(r, 200, 1200), leadStartMs, leadMs: between(r, 300, 1000), replyDelayMs: between(r, 800, 1800) }
      const v = run(s)
      if (v !== 'drop') throw new Error(`backchannel shown: ${JSON.stringify(s)}`)
    }
  })
})
