/**
 * Kayser, 2026-10-23: "when they say hmm it generates a new response so sometimes the suggested
 * line changes and sometimes I get caught like I'm reading". Then, on the next test call, "Doing
 * good, thanks" to his "Hi, how are you?" was taken for a "hmm", the pitch was dropped and the call
 * stalled. The gate goes by turn-taking timing.
 */
import { describe, it, expect } from 'vitest'
import { LineGate, AGENT_QUIET_MS } from '@/utils/line-gate'

function clock() {
  let t = 10_000
  return { now: () => t, tick: (ms: number) => { t += ms } }
}

describe('LineGate', () => {
  it('drops the reply to a short "hmm" when the agent keeps reading through it', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke()
    c.tick(300)
    g.leadStarted() // "Mhm."
    c.tick(900)
    g.leadStopped()
    expect(g.verdict()).toBe('hold') // can't tell yet
    for (let i = 0; i < 4; i++) { c.tick(400); g.agentSpoke() } // still reading the line
    expect(g.verdict()).toBe('drop')
  })

  it('shows the answer to the agent\'s question even when the agent\'s transcript lagged into it', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke() // "Hi, how are you?"
    c.tick(200)
    g.leadStarted() // "Doing good, thanks."
    c.tick(300)
    g.agentSpoke() // the agent's last words, transcribed late
    c.tick(700)
    g.leadStopped()
    expect(g.verdict()).toBe('hold')
    c.tick(AGENT_QUIET_MS) // the agent is waiting for the pitch, not talking
    expect(g.verdict()).toBe('show')
  })

  it('shows the reply to the same "mhm" said after the agent finished', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke()
    c.tick(AGENT_QUIET_MS + 200)
    g.leadStarted()
    c.tick(900)
    g.leadStopped()
    expect(g.verdict()).toBe('show')
  })

  it('holds the reply to a real interruption until the agent stops talking', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke()
    g.leadStarted()
    c.tick(2500) // "Wait, is this a real person or one of those robot calls?"
    g.agentSpoke()
    g.leadStopped()
    expect(g.verdict()).toBe('hold')
    c.tick(AGENT_QUIET_MS)
    expect(g.verdict()).toBe('show')
  })

  it('a new lead turn clears the backchannel mark', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke()
    g.leadStarted()
    c.tick(500)
    g.leadStopped()
    c.tick(800)
    g.agentSpoke()
    expect(g.verdict()).toBe('drop')
    c.tick(AGENT_QUIET_MS)
    g.leadStarted()
    c.tick(2000)
    g.leadStopped()
    expect(g.verdict()).toBe('show')
  })
})
