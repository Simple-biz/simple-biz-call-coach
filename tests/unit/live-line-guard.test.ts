import { describe, it, expect } from 'vitest'
import { guardLiveLine } from '@/utils/live-line-guard'
import { PRICING_REDIRECT } from '@infra/lib/lambda/shared/price-guard'
import { SCRIPT_DEFLECT } from '@infra/lib/lambda/shared/script-guard'
import { OPENER } from '@infra/lib/experiments/live-coach-instructions'
import type { LiveLineGuard as Guard } from '@/utils/live-line-guard'

// Past the opening: no goodbye can come before the pitch (Kayser's test call, 2026-10-23), so these
// guards start with the pitch said. It ends on a question, so it adds and counts nothing else.
const pitched = <G extends Guard>(g: G): G => { g.apply(OPENER, true); return g }

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
    const g = pitched(new LiveLineGuard());
    expect(g.apply(DECLINE_LINE, true)).toBe(DECLINE_LINE); // a real decline before any yes
    g.apply("Perfect. I'll have Bob or his partner reach out to you tomorrow morning.", true);
    expect(g.apply(DECLINE_LINE, true)).toBe(SIGNOFF_LINE);
  });
  it('a callback question does not count as confirmed', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const { DECLINE_LINE } = await import('@infra/lib/experiments/live-coach-instructions');
    const g = pitched(new LiveLineGuard());
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
    const g = pitched(new LiveLineGuard());
    expect(g.apply("It's Simple.biz. Would you mind if I have Bob or his partner give you a call?", true))
      .toBe("It's Simple.biz. Would you mind if I have Bob or his partner give you a call?");
    expect(g.apply('Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?', true))
      .toBe('Great question. Bob is in [Place]. Are you the one who handles the website?');
    // The line after an answer-only line may ask again.
    expect(g.apply("No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?", true))
      .toBe("No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?");
  });
  it('keeps a line that is only the callback question', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply('Would you mind if I have Bob or his partner give you a call?', true);
    expect(g.apply('Would you mind if I have Bob or his partner reach out to you later today?', true))
      .toBe('Would you mind if I have Bob or his partner reach out to you later today?');
  });
  // Kayser's second test call, 2026-10-23: four asks in 2.5 minutes, never two in a row.
  it('asks twice in a call, keeping the answers; later only when the lead is hedging', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    const lines = [
      'Would you mind if I have Bob or his partner give you a call?',
      "Yes, I'm a real person. I'm Bob's assistant.",
      "It's Simple.biz.",
      "That's great. We also help businesses improve and optimize their existing websites. Would you mind if I have Bob or his partner give you a call to talk about improving the look or ranking of your website?",
      "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?",
      "It's only free if we don't get you on Page 1 of Google and ChatGPT within 90 days. Would you mind if I have Bob or his partner give you a call to go over that?",
      "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?",
    ].map((l) => g.apply(l, true));
    expect(lines.filter((l) => /would you mind/i.test(l ?? ''))).toHaveLength(3);
    // Kayser: "we should not be the conversation ender". The answers that would stop dead get the
    // top bookers' two questions, once each.
    expect(lines[1]).toBe("Yes, I'm a real person. I'm Bob's assistant. Are you the one who handles the website?");
    expect(lines[2]).toBe("It's Simple.biz. Would this be for building a new website, or updating one?");
    // Third "Bob or his partner" of the call, so just "Bob".
    expect(lines[4]).toBe("Great question. It depends on what you're looking for. I'll have Bob give you a call to go over some options and pricing. Would that be okay?");
    // Kayser's third test call: "Does that help?" here, which no top booker says. The line before
    // didn't ask, so the callback ask is the question.
    expect(lines[5]).toBe("It's only free if we don't get you on Page 1 of Google and ChatGPT within 90 days. Would you mind if I have Bob give you a call?");
    // The lead is hedging right after an ask: the top bookers' softer version, not the same ask.
    expect(lines[6]).toBe("No problem. I understand you're busy. Is it okay if Bob calls you later today, when you're less busy?");
    expect(lines.some((l) => /does that help|fair enough/i.test(l ?? ''))).toBe(false);
  });
  // The month's top bookers said "Bob or his partner" 0.66 times a call; the coach said it 5-6 times.
  it('says "Bob or his partner" twice a call at most, then "Bob"', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply('Would you mind if I have Bob or his partner give you a call?', true);
    g.apply("Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing.", true);
    expect(g.apply("Perfect, I've got everything I need. Bob or his partner will give you a call later today.", true))
      .toBe("Perfect, I've got everything I need. Bob will give you a call later today. Would that work for you?");
  });
  // Sim 2026-10-23: the close asked who decides and build-or-update again after both were answered.
  it('skips close questions the call already asked', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    expect(g.apply("Yes, I'm a real person. I'm Bob's assistant.", true)).toMatch(/Are you the one who handles the website\?$/);
    expect(g.apply("It's Simple.biz.", true)).toMatch(/building a new website, or updating one\?$/);
    g.apply("Sure, I'll have Bob or his partner call you tomorrow morning before ten. Can I have your first name, please?", true);
    // Reworded by the model (sim 2026-10-23), still skipped. The close's last line reads back the
    // agreed time and asks (Kayser, 2026-10-24: leads don't always answer, so never end flat).
    expect(g.apply('Would they talk to you about the website, or is there someone else in charge of that?', true))
      .toBe("Perfect, I've got everything I need. Bob or his partner will give you a call tomorrow morning before ten. Would that work for you?");
    // The email line's own who-decides question isn't asked again either.
    const g2 = pitched(new LiveLineGuard());
    g2.apply("Yes, I'm a real person. I'm Bob's assistant.", true);
    expect(g2.apply("Absolutely. What's the best email address? Since I'm just his assistant, would they be calling to talk to you about the website, or is there someone else in charge of that?", true))
      .toBe("Absolutely. What's the best email address?");
    // The close's last line isn't said twice: with a goodbye, after it was said, the goodbye goes.
    expect(g.apply("Perfect, I've got everything I need. Bob or his partner will give you a call later today. Thanks so much. Have a beautiful day!", true))
      .toBe('Thanks so much. Have a beautiful day!');
  });
  // Sim 2026-10-23, the same run: three guard slips.
  it('adds no question to a goodbye in other words', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    expect(pitched(new LiveLineGuard()).apply('Absolutely. No problem. I appreciate your time—thanks again.', true))
      .toBe('Absolutely. No problem. I appreciate your time—thanks again.');
  });
  it('does not cut a line at "Dr."', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply("Yes, I'm a real person. I'm Bob's assistant.", true);
    // The whole who-decides sentence goes (not "Would they talk to Dr."), and the next question follows.
    expect(g.apply('Thanks. Would they talk to Dr. Patel about the website, or is there someone else in charge of that?', true))
      .toBe('Thanks. Would this be for building a new website, or updating one?');
  });
  it('asks for their first name once', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply("Sure, I'll have Bob or his partner call you after three. Can I have your first name, please?", true);
    expect(g.apply('Can I have your first name, please?', true))
      .toBe('Would they talk to YOU about the website, or is there someone else in charge of that?');
  });
  // Kayser's third test call: the lead had to ask "You said you had one more question?".
  it('carries the close on after a flat confirmation', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply("Sure, I'll have Bob or his partner call you tomorrow morning before ten. Can I have your first name, please?", true);
    expect(g.apply("Thanks, Dana. I'll have Bob call you tomorrow morning before ten.", true))
      .toBe("Thanks, Dana. I'll have Bob or his partner call you tomorrow morning before ten. Would they talk to YOU about the website, or is there someone else in charge of that?");
  });
  it('never says goodbye before the pitch', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = new LiveLineGuard();
    expect(g.apply("Hi Dana, how are you doing today?", true)).toBe("Hi Dana, how are you doing today?");
    expect(g.apply('No problem. I appreciate you taking my call.', true)).toBe(OPENER);
    // After the pitch, a real no gets the decline line.
    expect(g.apply('No problem. I appreciate you taking my call.', true)).toBe('No problem. I appreciate you taking my call.');
  });
  // 43 simulated calls: a lead who skipped the hello for questions never heard the pitch's exact
  // words, and her goodbye after a booked callback was turned into the pitch.
  it('lets a real goodbye through once the call is past the hello', async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = new LiveLineGuard();
    g.apply('Hi Dana, how are you doing today?', true);
    g.apply("Yes, I'm a real person. I'm Bob's assistant.", true);
    g.apply("Sure, I'll have Bob or his partner call you tomorrow morning before ten. Can I have your first name, please?", true);
    expect(g.apply('Thanks so much. Have a beautiful day!', true)).toBe('Thanks so much. Have a beautiful day!');
  });
  // Simulated calls: an interested lead pushing to "next year" got the decline line, twice in a round.
  it.each([
    ["Well, I'll be honest, we could use a better website, but we're not looking to do anything until next year. Thanks for calling though.", 'until next year'],
    ['We want to redo it at some point, just not right now. Thanks.', 'until [their date]'],
    ["Call me after the holidays, I'm swamped.", 'until after the holidays'],
  ])('gives the future-date line, not the decline, to: %s', async (lead, expected) => {
    const { futureDateInsteadOfDecline } = await import('@/utils/live-line-guard');
    const out = futureDateInsteadOfDecline('No problem. I appreciate you taking my call.', lead);
    expect(out).toContain(expected);
    expect(out).toContain('LATER TODAY');
  });
  it('keeps the decline line for a plain no', async () => {
    const { futureDateInsteadOfDecline } = await import('@/utils/live-line-guard');
    for (const lead of ["No thanks, I don't need a website. Word of mouth keeps me busy.", 'Not interested. Take me off your list.']) {
      expect(futureDateInsteadOfDecline('No problem. I appreciate you taking my call.', lead)).toBe('No problem. I appreciate you taking my call.');
    }
  });
  // Kayser, 2026-10-24: "it should not be the conversation ender, sometimes leads don't answer".
  it("ends the close and flat confirmations on a question, never a goodbye before the lead's", async () => {
    const { LiveLineGuard } = await import('@/utils/live-line-guard');
    const g = pitched(new LiveLineGuard());
    g.apply("Sure, I'll have Bob or his partner call you after three. Can I have your first name, please?", true);
    g.apply('Would they talk to YOU about the website, or is there someone else in charge of that?', true);
    g.apply("Just to make sure we're on the same page, is this to build a new website, or to update your existing website?", true);
    // The model tacked a goodbye on: dropped, the time read back, a question asked.
    expect(g.apply("Perfect, I've got everything I need. Bob or his partner will give you a call later today. Thanks so much. Have a beautiful day!", true))
      .toBe("Perfect, I've got everything I need. Bob or his partner will give you a call after three. Would that work for you?");
    const g2 = pitched(new LiveLineGuard());
    g2.apply("Sure, I'll have Bob or his partner call you later today. Can I have your first name, please?", true);
    g2.apply('Would they talk to YOU about the website, or is there someone else in charge of that?', true);
    g2.apply("Just to make sure we're on the same page, is this to build a new website, or to update your existing website?", true);
    expect(g2.apply('Got it. Bob will give you a call later today.', true)).toBe('Got it. Bob or his partner will give you a call later today. Would that work for you?');
  });
});
