import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInstructions, OPENER, REBUTTALS, DECLINE_LINE, PRICE_PUSHED_AGAIN } from '@infra/lib/experiments/live-coach-instructions';
import { SCRIPT_DEFLECT, CALLBACK_ASK } from '@infra/lib/lambda/shared/script-guard';
import { PRICING_REDIRECT } from '@infra/lib/lambda/shared/price-guard';

// The script's blanks are the agent's to fill; the instructions spell them as placeholders.
function withPlaceholders(line: string): string {
  return line
    .replace('Bob\'s number is ______', "Bob's number is [Bob's number]")
    .replace('{locationguide}', '[Place]')
    .replace('{PLACE NAME}', '[Place]')
    .replace('my name is _____', 'my name is [Agent]')
    .replace('until ____', 'until [their date]');
}

function scriptLines(section: string, nextSection: string): string[] {
  const doc = readFileSync(resolve(__dirname, '../../doc/reference/official-call-script.md'), 'utf8');
  const body = doc.slice(doc.indexOf(section), doc.indexOf(nextSection));
  return [...body.matchAll(/^> "(.+)"$/gm)].map(m => withPlaceholders(m[1]));
}

describe('live coach instructions', () => {
  const text = buildInstructions();

  it('carries every official rebuttal word for word', () => {
    const rebuttals = scriptLines('## Rebuttals', '## Guidelines');
    expect(rebuttals.length).toBeGreaterThanOrEqual(15);
    for (const line of rebuttals) expect(text).toContain(line);
  });

  it('carries the opener and the "doesn\'t understand" line word for word', () => {
    const [opener, explainer] = scriptLines('## Opener', '## Rebuttals');
    expect(OPENER).toBe(opener);
    expect(text).toContain(opener);
    expect(text).toContain(explainer);
  });

  // A second price push gets the best agents' line (2026-10-23 mining), not the guard's redirect
  // again; the guard still swaps any line that quotes a price for its redirect.
  it('uses the guards\' own lines for deflect and the callback ask, and the best agents\' second price answer', () => {
    expect(text).toContain(SCRIPT_DEFLECT);
    expect(text).toContain(PRICE_PUSHED_AGAIN);
    expect(text).not.toContain(PRICING_REDIRECT);
    expect(text).toContain(CALLBACK_ASK);
    expect(text).toContain(DECLINE_LINE);
  });

  it('quotes no price figure and fills in no city', () => {
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/\b\d+\s?(?:dollars|bucks)\b/i);
    expect(text).not.toMatch(/Topeka|Kansas City/i);
  });

  // "ChatGPT" is the script's own word for where leads rank, so only model ids are checked.
  it('never names a model or vendor', () => {
    expect(text).not.toMatch(/openai|\bgpt[- ]|realtime|claude|anthropic|haiku/i);
  });

  it('every rebuttal ends on a callback question, a clarifier, or the decline', () => {
    for (const [, say] of REBUTTALS) {
      expect(say === DECLINE_LINE || say.trim().endsWith('?') || say.includes('48,000')).toBe(true);
    }
  });
});
