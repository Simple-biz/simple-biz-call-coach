import { describe, it, expect } from 'vitest'
import { guardLiveLine } from '@/utils/live-line-guard'
import { PRICING_REDIRECT } from '@infra/lib/lambda/shared/price-guard'
import { SCRIPT_DEFLECT } from '@infra/lib/lambda/shared/script-guard'

describe('guardLiveLine', () => {
  it("passes the script's own 48,000 Page-1 rankings line unchanged", () => {
    const line = 'We back our work with over 48,000 Page-1 rankings on Google.'
    expect(guardLiveLine(line, true)).toBe(line)
    expect(guardLiveLine(line, false)).toBe(line)
  })

  it('replaces a final line quoting a price with the pricing redirect', () => {
    expect(guardLiveLine('Most sites run about $500 a month.', true)).toBe(PRICING_REDIRECT)
  })

  it('holds back a draft that is already quoting a price', () => {
    expect(guardLiveLine('Most sites run about $500', false)).toBeNull()
  })

  it('replaces a final unscripted claim with the script deflection, and holds the draft', () => {
    const claim = "Yeah, we can definitely set up online booking for you."
    expect(guardLiveLine(claim, true)).toBe(SCRIPT_DEFLECT)
    expect(guardLiveLine(claim, false)).toBeNull()
  })

  it('always offers the callback from Bob or his partner', () => {
    expect(guardLiveLine('Would you mind if I have Bob call you?', true)).toBe('Would you mind if I have Bob or his partner call you?')
    expect(guardLiveLine('Would you mind if I have Bob call you', false)).toBe('Would you mind if I have Bob or his partner call you')
  })

  it('leaves its own replacement lines alone', () => {
    expect(guardLiveLine(PRICING_REDIRECT, true)).toBe(PRICING_REDIRECT)
    expect(guardLiveLine(SCRIPT_DEFLECT, true)).toBe(SCRIPT_DEFLECT)
  })
})
