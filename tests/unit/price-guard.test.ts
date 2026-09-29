import { describe, it, expect } from 'vitest';
// price-guard has no dependencies, so this runs in CI without the infra packages installed.
// parseAITipResponse applies it to every suggestion before it reaches the agent.
import { mentionsPrice, PRICING_REDIRECT } from '@infra/lib/lambda/shared/price-guard';

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
  });

  it.each([
    'As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don\'t pay a dime.',
    "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?",
    'We are a hundred percent local.',
    "Excellent. I know you won't be ready to do anything for a month, but would it be okay if Bob or his partner reach out to you LATER TODAY to discuss some ideas with you?",
    'Thousands of local businesses show up on Page 1.',
  ])('leaves script lines alone: %s', (s) => {
    expect(mentionsPrice(s)).toBe(false);
  });

  it('the redirect itself passes the guard', () => {
    expect(mentionsPrice(PRICING_REDIRECT)).toBe(false);
  });
});
