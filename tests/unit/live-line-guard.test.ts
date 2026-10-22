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

// Mass test 2026-10-23 (50 calls).
describe('oneCallbackStatement', () => {
  it('drops a glued second callback statement and the stray "Got it."', async () => {
    const { oneCallbackStatement } = await import('@/utils/live-line-guard');
    expect(oneCallbackStatement("Perfect. I'll have Bob or his partner reach out to you later today. Got it. Bob or his partner will give you a call later today."))
      .toBe("Perfect. I'll have Bob or his partner reach out to you later today.");
  });
  it('leaves a callback question alone', async () => {
    const { oneCallbackStatement } = await import('@/utils/live-line-guard');
    const q = "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?";
    expect(oneCallbackStatement(q)).toBe(q);
  });
});

describe('LiveLineGuard', () => {
  it('turns the decline line into the sign-off once a callback was confirmed', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const { DECLINE_LINE, SIGNOFF_LINE } = await import('@infra/lib/experiments/live-coach-instructions');
    const g = new LiveLineGuard();
    expect(g.apply(DECLINE_LINE, true)).toBe(DECLINE_LINE); // a real decline before any yes
    g.apply("Perfect. I'll have Bob or his partner reach out to you tomorrow morning.", true);
    expect(g.apply(DECLINE_LINE, true)).toBe(SIGNOFF_LINE);
  });
  it('a callback question does not count as confirmed', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const { DECLINE_LINE } = await import('@infra/lib/experiments/live-coach-instructions');
    const g = new LiveLineGuard();
    g.apply('Would you mind if I have Bob or his partner give you a call?', true);
    expect(g.apply(DECLINE_LINE, true)).toBe(DECLINE_LINE);
  });
});

// Mass test round 2 (2026-10-23).
describe('withoutForbiddenAsks', () => {
  it.each([
    ["Perfect. What's the best number for him to reach you?", 'Perfect.'],
    ['Got it, lewis@tacolewis.com. Would you mind if I have Bob or his partner give you a call?', 'Would you mind if I have Bob or his partner give you a call?'],
    ["Absolutely. What's the best email address for [the owner]?", "Absolutely. What's the best email address for the owner?"],
    ['Thanks so much, [Name]. Have a beautiful day!', 'Thanks so much. Have a beautiful day!'],
  ])('%s', async (input, expected) => {
    const { withoutForbiddenAsks } = await import('@/utils/live-line-guard');
    expect(withoutForbiddenAsks(input)).toBe(expected);
  });
  it("keeps Bob's number and the script's email question", async () => {
    const { withoutForbiddenAsks } = await import('@/utils/live-line-guard');
    for (const s of ["Bob's number is [Bob's number]. So we don't end up playing phone tag, would you mind if I have Bob or his partner give you a call?",
      "Absolutely. What's the best email address? Bob or his partner can send over some examples of websites they've built for businesses like yours."]) {
      expect(withoutForbiddenAsks(s)).toBe(s);
    }
  });
  it('falls back to the callback ask when nothing is left', async () => {
    const { withoutForbiddenAsks } = await import('@/utils/live-line-guard');
    const { CALLBACK_ASK } = await import('@infra/lib/lambda/shared/script-guard');
    expect(withoutForbiddenAsks('Is this the best number to reach you?')).toBe(CALLBACK_ASK);
  });
});

// Mass test round 3 (2026-10-23).
describe('phone numbers the coach writes', () => {
  it.each([
    ["Bob's number is 555-123-4567. Would you mind if I have Bob or his partner give you a call?", "Bob's number is [Bob's number]. Would you mind if I have Bob or his partner give you a call?"],
    ['You can reach him at (785) 555-0199.', "You can reach him at [Bob's number]."],
    ['Bob’s number is [Bob’s number].', "Bob’s number is [Bob's number]."],
  ])('%s', async (input, expected) => {
    const { withoutForbiddenAsks } = await import('@/utils/live-line-guard');
    expect(withoutForbiddenAsks(input)).toBe(expected);
  });
  it('leaves the 48,000 rankings and 90 days alone', async () => {
    const { withoutForbiddenAsks } = await import('@/utils/live-line-guard');
    const s = "As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don't pay a dime.";
    expect(withoutForbiddenAsks(s)).toBe(s);
  });
});

// Kayser's test call, 2026-10-23: the callback question on 7 lines in 3 minutes.
describe('LiveLineGuard: callback question pacing', () => {
  it('never asks the callback question in two lines in a row', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = new LiveLineGuard();
    expect(g.apply("It's Simple.biz. Would you mind if I have Bob or his partner give you a call?", true))
      .toBe("It's Simple.biz. Would you mind if I have Bob or his partner give you a call?");
    expect(g.apply('Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?', true))
      .toBe('Great question. Bob is in [Place].');
    // The line after an answer-only line may ask again.
    expect(g.apply("No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?", true))
      .toBe("No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?");
  });
  it('keeps a line that is only the callback question', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = new LiveLineGuard();
    g.apply('Would you mind if I have Bob or his partner give you a call?', true);
    expect(g.apply('Would you mind if I have Bob or his partner reach out to you later today?', true))
      .toBe('Would you mind if I have Bob or his partner reach out to you later today?');
  });
});
