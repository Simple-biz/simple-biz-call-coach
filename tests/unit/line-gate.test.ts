/**
 * Kayser, 2026-10-23: "when they say hmm it generates a new response so sometimes the suggested
 * line changes and sometimes I get caught like I'm reading". The gate goes by turn-taking timing.
 */
import { describe, it, expect } from 'vitest'
import { LineGate, AGENT_QUIET_MS } from '@/utils/line-gate'

function clock() {
  let t = 10_000
  return { now: () => t, tick: (ms: number) => { t += ms } }
}

describe('LineGate', () => {
  it('drops the reply to a short "hmm" made while the agent is reading', () => {
    const c = clock()
    const g = new LineGate(c.now)
    g.agentSpoke()
    c.tick(300)
    g.leadStarted()
    c.tick(900)
    g.agentSpoke()
    g.leadStopped()
    expect(g.verdict()).toBe('drop')
  })

  it('shows the reply to the same "mhm" said after the agent finished (an answer)', () => {
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
    g.agentSpoke() // the agent is still finishing their sentence
    g.leadStopped()
    expect(g.verdict()).toBe('hold')
    expect(g.msUntilQuiet()).toBe(AGENT_QUIET_MS)
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
    expect(g.verdict()).toBe('drop')
    c.tick(AGENT_QUIET_MS)
    g.leadStarted()
    c.tick(2000)
    g.leadStopped()
    expect(g.verdict()).toBe('show')
  })
})
