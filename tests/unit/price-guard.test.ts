import { describe, it, expect } from 'vitest';
import { mentionsPrice, parseAITipResponse, PRICING_REDIRECT } from '@infra/lib/lambda/shared/claude-client-optimized';

const tip = (script: string) => `[HEADING]: Pricing\n[STAGE]: CLOSING\n[SCRIPT]: "${script}"`;

describe('price guard', () => {
  it.each([
    'Honestly, it ranges from a few hundred to several thousand depending on what you need.',
    "I've seen websites range from a couple thousand to way more.",
    'Some clients are a few hundred a month.',
    'Most sites run about $1,500.',
    'Usually around 500 dollars.',
    'It is roughly 2k to start.',
  ])('flags a price figure: %s', (s) => {
    expect(mentionsPrice(s)).toBe(true);
    expect(parseAITipResponse(tip(s), 'closing').suggestion).toBe(PRICING_REDIRECT);
  });

  it.each([
    'As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don\'t pay a dime.',
    "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?",
    'We are a hundred percent local.',
  ])('leaves script lines alone: %s', (s) => {
    expect(mentionsPrice(s)).toBe(false);
    expect(parseAITipResponse(tip(s), 'closing').suggestion).toBe(s);
  });
});
