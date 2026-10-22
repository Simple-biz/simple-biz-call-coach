import { describe, it, expect } from 'vitest';
import { claimsUnscriptedFact, addHisPartner, fixWeakEnding, CALLBACK_ASK, THEM_ASK } from '@infra/lib/lambda/shared/script-guard';

// Lines are taken from simulated calls (npm run sim) where the coach slipped.
describe('claimsUnscriptedFact', () => {
  it.each([
    "Absolutely — we've built a ton of websites here in Topeka.",
    "Yes, we've built sites for chiropractors and other healthcare practices.",
    "A lot of shops we work with were in the same boat.",
    "And for online booking, that's definitely something Bob or his partner can set up.",
    'We can definitely set up online booking for your classes.',
    "And we don't have a formal company name, it's just Bob Hansen's website design team.",
    "We don't have a formal company name — we're just local website designers.",
  ])('flags: %s', (s) => expect(claimsUnscriptedFact(s)).toBe(true));

  it.each([
    "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built for businesses like yours. Would you mind if I have them give you a call?",
    "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built in your area. Would you mind if I have them give you a call?",
    "Great question. I'm just Bob's assistant, so I don't want to give you the wrong answer. Would you mind if I have Bob or his partner give you a call to answer that for you?",
    'We are local website developers that provide complete web design, hosting, and SEO.',
    "That's great. We also help businesses improve and optimize their existing websites.",
  ])('leaves script lines alone: %s', (s) => expect(claimsUnscriptedFact(s)).toBe(false));
});

describe('addHisPartner', () => {
  it('adds "or his partner" to a Bob-only callback', () => {
    expect(addHisPartner("Perfect, Mike. I'll have Bob give you a call later today.")).toBe("Perfect, Mike. I'll have Bob or his partner give you a call later today.");
    expect(addHisPartner('Bob will call you back after 2.')).toBe('Bob or his partner will call you back after 2.');
  });
  it('leaves correct and non-callback mentions alone', () => {
    for (const s of ["I'll have Bob or his partner give you a call.", "Bob's number is 785-555-0142.", 'Bob Hansen and I are local website designers.']) {
      expect(addHisPartner(s)).toBe(s);
    }
  });
});

describe('fixWeakEnding', () => {
  it('replaces a weak close before agreement', () => {
    expect(fixWeakEnding('It only takes five minutes to see whether it makes sense. Fair enough?', 'objection'))
      .toBe(`It only takes five minutes to see whether it makes sense. ${CALLBACK_ASK}`);
  });
  // Found by the v3 regression snapshot: the full ask was repeated after a line that already offered the call.
  it('does not repeat "Bob or his partner" when the line already names them', () => {
    expect(fixWeakEnding("Great, I'll have Bob or his partner give you a call later today. Does that work?", 'closing'))
      .toBe(`Great, I'll have Bob or his partner give you a call later today. ${THEM_ASK}`);
  });
  it('drops the weak close when the line already asks for the callback', () => {
    expect(fixWeakEnding('Would you mind if I have Bob or his partner give you a call — sound fair?', 'discovery'))
      .toBe('Would you mind if I have Bob or his partner give you a call?');
  });
  it('keeps confirmations after the lead agreed', () => {
    const s = 'Bob or his partner will reach out later today. Does that work?';
    expect(fixWeakEnding(s, 'conversion')).toBe(s);
  });
});
