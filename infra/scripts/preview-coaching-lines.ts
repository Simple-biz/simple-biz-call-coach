/**
 * Local naturalness preview for the coaching prompt.
 *
 * Calls Claude DIRECTLY with the new SYSTEM_PROMPT_COMPRESSED + stage-filtered
 * scripts, so we can read the actual suggested lines WITHOUT deploying to the
 * production Lambda. Focuses on the scenarios Ron flagged (gatekeeper email,
 * "send me an email", "not right now", pricing) plus a normal close.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/preview-coaching-lines.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  SYSTEM_PROMPT_COMPRESSED,
  getScriptsForStage,
  buildCompressedPrompt,
  type AITipRequest,
} from '../lib/lambda/shared/claude-client-optimized';

const MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20250929';

type Scenario = {
  name: string;
  req: AITipRequest;
};

const SCENARIOS: Scenario[] = [
  {
    name: 'GATEKEEPER asks to take a message (must NOT chase email)',
    req: {
      conversationId: 'preview-1',
      callStage: 'discovery',
      transcriptCount: 4,
      recentTranscript:
        "agent: Hi, my name is Mark. Bob Hansen and I are website designers here in Topeka. Is the owner available?\n" +
        "caller: This is the front desk, the owner isn't in right now. Can I take a message?",
      collectedInfo: { customerName: false, businessName: false, phoneNumber: true, email: false },
    },
  },
  {
    name: '"Send me an email" (the ONLY place email is allowed — must pivot to callback)',
    req: {
      conversationId: 'preview-2',
      callStage: 'objection',
      transcriptCount: 6,
      recentTranscript:
        "agent: Bob Hansen and I are local website designers, we're very affordable.\n" +
        "caller: Just send me an email with your info.",
      collectedInfo: { customerName: false, businessName: false, phoneNumber: true, email: false },
    },
  },
  {
    name: '"Not right now" with no reason (should clarify: have a site, or busy?)',
    req: {
      conversationId: 'preview-3',
      callStage: 'objection',
      transcriptCount: 3,
      recentTranscript:
        "agent: I wanted to see if you'd be interested in talking with someone local about your website?\n" +
        "caller: No, not right now.",
      collectedInfo: { customerName: false, businessName: false, phoneNumber: true, email: false },
    },
  },
  {
    name: 'Pricing question (defer to Bob, ask for callback)',
    req: {
      conversationId: 'preview-4',
      callStage: 'closing',
      transcriptCount: 7,
      recentTranscript:
        "agent: We're very affordable and we build sites that rank well on Google.\n" +
        "caller: How much would a simple website cost?",
      collectedInfo: { customerName: true, businessName: true, phoneNumber: true, email: false },
    },
  },
  {
    name: 'Agreed to callback (confirm time + name, NO email chase)',
    req: {
      conversationId: 'preview-5',
      callStage: 'conversion',
      transcriptCount: 9,
      recentTranscript:
        "agent: Would you mind if I have Bob or his partner give you a quick call later?\n" +
        "caller: Yeah sure, that's fine.",
      collectedInfo: { customerName: false, businessName: true, phoneNumber: true, email: false },
    },
  },
];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY to run this preview.');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  for (const { name, req } of SCENARIOS) {
    const system = `${SYSTEM_PROMPT_COMPRESSED}\n\n${getScriptsForStage(req.callStage)}`;
    const user = buildCompressedPrompt(req);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    console.log('\n========================================');
    console.log(`SCENARIO: ${name}`);
    console.log(`STAGE: ${req.callStage}`);
    console.log('----------------------------------------');
    console.log(text);
  }
  console.log('\n========================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
