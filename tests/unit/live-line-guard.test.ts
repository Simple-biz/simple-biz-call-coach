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

describe('oneCallbackAsk', () => {
  it('keeps only the last callback question when rebuttals are stacked', async () => {
    const { oneCallbackAsk } = await import('@/utils/live-line-guard');
    const stacked = "Well, I'm glad I called, then! I'll have Bob or his partner give you a call to talk about building one. Would you mind if I have either of them give you a call? Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?";
    expect(oneCallbackAsk(stacked)).toBe("Well, I'm glad I called, then! I'll have Bob or his partner give you a call to talk about building one. Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?");
  });
  it('leaves a single rebuttal alone', async () => {
    const { oneCallbackAsk } = await import('@/utils/live-line-guard');
    const one = "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?";
    expect(oneCallbackAsk(one)).toBe(one);
  });
});
