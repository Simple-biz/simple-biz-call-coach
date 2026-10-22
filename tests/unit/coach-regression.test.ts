import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT_COMPRESSED,
  getScriptsForStage,
  buildCompressedPrompt,
  parseAITipResponse,
  getFallbackSuggestion,
} from '@infra/lib/lambda/shared/claude-client-optimized';

// v3 regression net for today's coach. The live coach takes over the suggested line, but today's
// coach stays on as the fallback ("Get Next Suggestion"), and v3 must not change what it says.
// Model output can't be snapshotted, so this pins everything deterministic around it: the system
// prompt, the stage scripts, the prompt built from a request, and how raw model text is parsed
// and guarded. A deliberate change to any of these updates the snapshot (`vitest -u`) in the same
// commit, so the diff shows exactly what moved.

const STAGES = ['greeting', 'discovery', 'objection', 'closing', 'conversion', 'signoff'];

const RAW_REPLIES: Array<[string, string]> = [
  ['objection', '[HEADING]: Busy Lead\n[STAGE]: OBJECTION_HANDLING\n[CONTEXT]: Lead is busy.\n[SCRIPT]: "No problem. I understand you\'re busy. Would you mind if I have Bob or his partner give you a call to talk about your website?"'],
  ['objection', '[HEADING]: Price Ask\n[STAGE]: OBJECTION_HANDLING\n[SCRIPT]: "Most sites run about $1,500, depending on what you need."'],
  ['discovery', '[HEADING]: Past Work\n[STAGE]: VALUE_PROP\n[SCRIPT]: "We\'ve built a ton of sites in Topeka for shops like yours."'],
  ['closing', '[HEADING]: Callback\n[STAGE]: CLOSING\n[SCRIPT]: "Great, I\'ll have Bob give you a call later today. Does that work?"'],
  ['conversion', '[HEADING]: Confirm\n[STAGE]: CONVERSION\n[SCRIPT]: "Perfect, Bob or his partner will reach out later today. Sound good?"'],
  ['greeting', 'no tags at all, just a sentence the model blurted'],
];

describe('today\'s coach does not change in v3', () => {
  it('system prompt', () => {
    expect(SYSTEM_PROMPT_COMPRESSED).toMatchSnapshot();
  });

  it.each(STAGES)('stage scripts: %s', (stage) => {
    expect(getScriptsForStage(stage)).toMatchSnapshot();
  });

  it('prompt built from a request', () => {
    const prompt = buildCompressedPrompt({
      conversationId: 'regression',
      callStage: 'objection',
      recentTranscript: 'agent: Hi, my name is Jen.\ncustomer: We already have a website.',
      transcriptCount: 2,
      conversationFacts: ['Lead has an existing website'],
      collectedInfo: { customerName: 'Dana', businessName: '', email: '' },
    } as any);
    expect(prompt).toMatchSnapshot();
  });

  it.each(RAW_REPLIES)('parse and guards (%s): %s', (stage, raw) => {
    expect(parseAITipResponse(raw, stage)).toMatchSnapshot();
  });

  it.each(STAGES)('fallback line: %s', (stage) => {
    const { latency, ...rest } = getFallbackSuggestion(stage, 0) as any;
    expect(rest).toMatchSnapshot();
  });
});
