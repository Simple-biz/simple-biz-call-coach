// Use raw fetch instead of SDK (not installed in root)


const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ============================================================================
// COPY OF PRODUCTION PROMPT (must match claude-client-optimized.ts)
// ============================================================================

const MARKS_GOLDEN_SCRIPTS = `# MARK'S QUALITY SCRIPTS (27 PROVEN PATTERNS - CLEAN & INTENT-MATCHED)

## GREETING (4 scripts)
1. Basic Intro [ID: intro-basic]: "My name is [Agent], and Bob and I are here; we're local website designers here in [Location]."
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent], and Bob and I are here; we're local website designers here in [Location]."

## VALUE PROPOSITION (3 scripts)
1. Affordable Hook [ID: hook-affordable]: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all."
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Location]."

## OBJECTION HANDLING (8 scripts)
1. Have One/Busy [ID: obj-busy-or-have]: "You already got one though, or just busy right now to talk about it?"
2. SEO Pivot: "That's great because we also optimize websites as well, especially with SEO, at super affordable costs."
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO."
4. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO."
5. Digital Marketing Pivot: "Of course yeah. I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO."
6. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business."

## CLOSING (11 scripts)
1. Ask Callback [ID: ask-callback]: "Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
2. Get Email: "What's your email?"
3. Confirm Name: "And your name is? ... You're the owner? You're [Name]?"
4. Trust/Source: "We're scouting small to medium local businesses in the area, so we just got your number off of Google."
5. Soft Close: "And would it be okay, [Name], if I can have either Bob or his partner give you a quick call later? Should be a quick call."
6. Value Pricing: "So then you can know pricing and all that."
7. Decision Maker: "And [Name], you're the person in charge of the website we could talk to, right? Just to confirm."
8. Ask + FOMO: "Would you mind if I can have Bob or his partner give you a quick call later? Just don't want you to miss out."
9. Confirm Authority: "You're the owner? [Name]? ... and you're the person in charge of the website to talk about later just to confirm?"
10. Pricing/Samples: "Would you mind if I could have Bob or his partner give you a quick call later today to talk about pricing and all these samples?"

## CONVERSION (2 scripts)
1. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
2. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

const SYSTEM_PROMPT = `Sales coach for local digital services (SEO/web design). Target: small business owners. Goal: Get customer to agree to callback from Bob/partner.

YOUR TASK: Analyze recent transcript and select the SINGLE BEST script from Mark's library based on customer intent and conversation stage.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title (e.g., "Intro", "Ask Callback")
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION_HANDLING, CLOSING, CONVERSION
[CONTEXT]: One sentence explaining why (optional)
[SCRIPT]: ONLY the exact script text - NO rationale, NO explanation, NO value proposition text

CUSTOMER INTENT MATCHING RULES (PRIORITY ORDER):
1. Customer is AI assistant/voicemail (says "I'm Delta's AI", "Leave a message", "Press 1 for", etc.) -> USE: Quick Intro [ID: intro-basic] and suggest asking for human/callback
2. HIGHEST PRIORITY - Customer has AGREED to callback (says "yes", "sure", "I'm good with that", "that works", "sounds good", etc. in response to callback ask) -> IMMEDIATELY switch to CONVERSION stage. USE: Confirm Name, Get Email, or Confirm Authority - collect their details. NEVER re-ask for callback after agreement.
3. Customer asks "Who is this?" or "Who are you?" -> USE: Basic Intro [ID: intro-basic]
4. Customer asks "What do you need?" or "I'm busy" or "What is this about?" -> USE: Affordable Hook [ID: hook-affordable]
5. Customer says "We already have a website" or "I already have one" or "Not interested" -> USE: Have One/Busy [ID: obj-busy-or-have]
6. After agent delivered pitch AND handled objections AND customer has NOT yet agreed -> USE: Ask Callback [ID: ask-callback]
7. Customer asks about ownership/control -> USE: IP/Control Assurance
8. Customer asks "what do you need from me?" or "do you need my details?" after agreeing -> USE: Get Email or Confirm Name - they are ready to give info

STAGE DETERMINATION (Analyze transcript to determine current stage - OVERRIDE the Stage field if transcript shows a different stage):
- GREETING: First 1-2 exchanges, no pitch given yet
- VALUE_PROP: Intro done, customer asking what you want, pitch not fully delivered
- OBJECTION_HANDLING: Customer expressed resistance/objection/has existing solution
- CLOSING: Pitch delivered, objections handled, time to ask for callback
- CONVERSION: Customer agreed to callback (said "yes", "sure", "sounds good", "I'm good with that"). NOW collect their info: name, email, authority. NEVER go back to CLOSING after this.

CONTEXT-AWARE PERSONALIZATION:
- Keep 80%+ of Mark's proven wording EXACTLY as written
- Remove ALL filler words: "uh", "uhm", "ah", "you know", "I mean", "Oh"
- Goal: Build rapport -> secure callback agreement`;

// ============================================================================
// CONVERSION DETECTION LOGIC (mirrors intelligence/index.ts)
// ============================================================================

function detectConversion(transcripts, transcriptCount) {
  let callStage;
  if (transcriptCount < 5) callStage = 'greeting';
  else if (transcriptCount < 10) callStage = 'discovery';
  else if (transcriptCount < 20) callStage = 'objection';
  else callStage = 'closing';

  // transcripts are in DESC order (newest first)
  const recentCustomerMessages = transcripts
    .slice(0, 10)
    .filter(t => t.speaker === 'caller')
    .map(t => t.text.toLowerCase());

  const agreementSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "i'm good with that", "that's great", "that's fine", "that works", "i'm down", "i'm interested", "go ahead", "let's do it", "fine"];
  const hasAgreed = recentCustomerMessages.some(msg =>
    agreementSignals.some(signal => msg.includes(signal))
  );

  const recentAgentMessages = transcripts
    .slice(0, 10)
    .filter(t => t.speaker === 'agent')
    .map(t => t.text.toLowerCase());
  const askedCallback = recentAgentMessages.some(msg =>
    msg.includes('bob') || msg.includes('call later') || msg.includes('callback') || msg.includes('quick call')
  );

  if (hasAgreed && askedCallback) {
    callStage = 'conversion';
  }

  return { callStage, hasAgreed, askedCallback };
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

const SCENARIOS = [
  {
    name: '1. HAPPY PATH — Customer agrees to callback',
    expectStage: 'conversion',
    expectNotContain: 'would you mind',
    transcripts: [
      { speaker: 'agent', text: 'This is Caesar from simple.biz.' },
      { speaker: 'agent', text: "I'm reaching out about your business website. Do you have a minute?" },
      { speaker: 'caller', text: 'Yeah sure I have a minute.' },
      { speaker: 'agent', text: "We're just wondering if you're interested in building or updating your website since we're super affordable." },
      { speaker: 'caller', text: 'I have an old website that needs updating.' },
      { speaker: 'caller', text: 'Can you give me more details?' },
      { speaker: 'agent', text: "That's great that you already have one because we also optimize websites as well, especially with SEO." },
      { speaker: 'agent', text: 'Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?' },
      { speaker: 'caller', text: "Yes. That's fine. Sure." },
      { speaker: 'caller', text: 'Do you need any details from my end?' },
    ].reverse() // DESC order
  },
  {
    name: '2. FALSE POSITIVE — Customer says "yes" to having a website (not agreeing to callback)',
    expectStage: 'objection',
    transcripts: [
      { speaker: 'agent', text: 'This is Caesar from simple.biz.' },
      { speaker: 'agent', text: "We're wondering if you're interested in building or updating your website." },
      { speaker: 'caller', text: 'Yes I already have a website.' },
      { speaker: 'caller', text: "I'm not really looking to change anything right now." },
      { speaker: 'agent', text: "That's great because we also optimize websites as well." },
      { speaker: 'caller', text: 'Yeah I have one already, no thanks.' },
      { speaker: 'agent', text: 'You already got one though, or just busy right now to talk about it?' },
      { speaker: 'caller', text: "I'm just busy." },
      { speaker: 'agent', text: 'Okay no worries.' },
      { speaker: 'caller', text: 'Yeah thanks.' },
    ].reverse()
  },
  {
    name: '3. VOICEMAIL / AI ASSISTANT',
    expectStage: 'greeting',
    transcripts: [
      { speaker: 'agent', text: 'Hello, good morning.' },
      { speaker: 'caller', text: "Hi, you've reached Delta's AI assistant. The person you're calling is not available." },
      { speaker: 'caller', text: 'Please leave a message after the tone.' },
    ].reverse()
  },
  {
    name: '4. LUKEWARM "okay" — might be agreement or might be just acknowledging',
    expectStage: 'conversion',
    transcripts: [
      { speaker: 'agent', text: 'This is Caesar from simple.biz.' },
      { speaker: 'agent', text: "We're super affordable website designers." },
      { speaker: 'caller', text: 'Alright what do you need?' },
      { speaker: 'agent', text: "We're just wondering if you're interested in updating your website." },
      { speaker: 'caller', text: 'I might be interested.' },
      { speaker: 'agent', text: "That's great. We also do SEO at super affordable costs." },
      { speaker: 'agent', text: 'Would you mind if I can have Bob or his partner give you a quick call later?' },
      { speaker: 'caller', text: 'Okay.' },
      // Just "okay" — is this agreement or dismissal?
      // Detection should catch it since agent asked callback + customer said "okay"
      { speaker: 'agent', text: 'Great.' },
      { speaker: 'caller', text: 'When would they call?' },
    ].reverse()
  },
  {
    name: '5. CUSTOMER OBJECTS AFTER PITCH — should stay in objection handling',
    expectStage: 'objection',
    transcripts: [
      { speaker: 'agent', text: 'This is Caesar from simple.biz.' },
      { speaker: 'agent', text: "We're reaching out about your business website." },
      { speaker: 'caller', text: 'What is this about?' },
      { speaker: 'agent', text: "We're just wondering if you're interested in building or updating your website." },
      { speaker: 'caller', text: 'We already have a website and we are happy with it.' },
      { speaker: 'caller', text: "I don't think we need anything right now." },
      { speaker: 'agent', text: "That's great that you already have one because we also optimize websites." },
      { speaker: 'caller', text: "No I'm really not interested." },
      { speaker: 'caller', text: "We have a guy who handles that." },
      { speaker: 'agent', text: 'Of course yeah.' },
    ].reverse()
  },
  {
    name: '6. EARLY CALL — customer asks who is this',
    expectStage: 'greeting',
    transcripts: [
      { speaker: 'agent', text: 'Hi good morning.' },
      { speaker: 'caller', text: 'Hello? Who is this?' },
    ].reverse()
  },
  {
    name: '7. CUSTOMER AGREES THEN GOES SILENT — agent needs to re-engage',
    expectStage: 'conversion',
    transcripts: [
      { speaker: 'agent', text: 'This is Caesar from simple.biz.' },
      { speaker: 'agent', text: "We're reaching out about website design." },
      { speaker: 'caller', text: 'Oh okay.' },
      { speaker: 'agent', text: "We're just wondering if you're interested in building or updating your website since we're super affordable." },
      { speaker: 'caller', text: 'Yeah maybe.' },
      { speaker: 'agent', text: 'Would you mind if I can have Bob or his partner give you a quick call later?' },
      { speaker: 'caller', text: 'Yeah sure.' },
      // Silence... agent needs to collect details
    ].reverse()
  },
  {
    name: '8. CUSTOMER ASKS ABOUT PRICING — not yet agreed',
    expectStage: 'closing',
    transcripts: Array.from({length: 15}, (_, i) => ({ speaker: i % 2 === 0 ? 'agent' : 'caller', text: `Exchange ${i+1}` })).concat([
      { speaker: 'agent', text: "We're super affordable website designers." },
      { speaker: 'caller', text: 'How much does it cost?' },
      { speaker: 'agent', text: 'We have different packages.' },
      { speaker: 'caller', text: 'Can you tell me the price range?' },
      { speaker: 'agent', text: 'Would you mind if Bob could call you later to discuss pricing?' },
      { speaker: 'caller', text: 'What kind of prices are we talking about though?' },
    ]).reverse()
  },
  {
    name: '9. CUSTOMER SAYS "yeah" CASUALLY (not agreement to callback)',
    expectStage: 'closing',
    transcripts: Array.from({length: 15}, (_, i) => ({ speaker: i % 2 === 0 ? 'agent' : 'caller', text: `Exchange ${i+1}` })).concat([
      { speaker: 'agent', text: "We're local website designers here in Las Vegas." },
      { speaker: 'caller', text: 'Yeah I know the area.' },
      { speaker: 'agent', text: "We're super affordable." },
      { speaker: 'caller', text: 'Yeah.' },
      { speaker: 'agent', text: "Just don't want you to miss out." },
    ]).reverse()
  },
  {
    name: '10. SIGN-OFF — customer already agreed, agent wrapping up',
    expectStage: 'conversion',
    transcripts: Array.from({length: 15}, (_, i) => ({ speaker: i % 2 === 0 ? 'agent' : 'caller', text: `Exchange ${i+1}` })).concat([
      { speaker: 'agent', text: 'Would you mind if I can have Bob give you a quick call later?' },
      { speaker: 'caller', text: "Sure that sounds good." },
      { speaker: 'agent', text: "What's your email?" },
      { speaker: 'caller', text: "It's john@gmail.com." },
      { speaker: 'agent', text: "And you're the owner right?" },
      { speaker: 'caller', text: 'Yes I am.' },
    ]).reverse()
  },
];

// ============================================================================
// RUN TESTS
// ============================================================================

async function callClaude(stage, conversationContext, transcriptCount) {
  const userPrompt = `Stage: ${stage}\nTranscript Count: ${transcriptCount}\n\nRecent Conversation:\n${conversationContext.substring(0, 800)}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 150,
      temperature: 0.3,
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: MARKS_GOLDEN_SCRIPTS }
      ],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].type === 'text' ? data.content[0].text : '';
}

async function main() {
  console.log('=' .repeat(80));
  console.log('COACHING AI SCENARIO TESTS');
  console.log('=' .repeat(80));

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TEST: ${scenario.name}`);
    console.log(`${'─'.repeat(80)}`);

    const count = scenario.transcripts.length;

    // 1. Test conversion detection logic
    const detection = detectConversion(scenario.transcripts, count);
    const stageMatch = detection.callStage === scenario.expectStage;

    console.log(`  Detection: stage=${detection.callStage} (expected: ${scenario.expectStage}) | agreed=${detection.hasAgreed} | askedCallback=${detection.askedCallback}`);
    console.log(`  Stage Match: ${stageMatch ? 'PASS' : 'FAIL'}`);

    // 2. Call Claude with the detected stage
    const chronological = [...scenario.transcripts].reverse();
    const recentContext = chronological.slice(-15);
    const conversationContext = recentContext
      .map(t => `${t.speaker.toUpperCase()}: "${t.text}"`)
      .join('\n');

    try {
      const aiResponse = await callClaude(detection.callStage, conversationContext, count);

      // Parse response
      const heading = aiResponse.match(/\[HEADING\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '?';
      const stage = aiResponse.match(/\[STAGE\]:\s*(\w+)/i)?.[1]?.trim() || '?';
      const script = aiResponse.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim().replace(/^["']|["']$/g, '') || '?';

      console.log(`  AI Response:`);
      console.log(`    Heading: ${heading}`);
      console.log(`    Stage:   ${stage}`);
      console.log(`    Script:  "${script.substring(0, 100)}${script.length > 100 ? '...' : ''}"`);

      // Check for bad patterns
      let scenarioPassed = stageMatch;
      const issues = [];

      if (scenario.expectStage === 'conversion' && script.toLowerCase().includes('would you mind')) {
        issues.push('AI re-asked for callback after customer agreed');
        scenarioPassed = false;
      }
      if (scenario.expectStage === 'greeting' && stage === 'CLOSING') {
        issues.push('AI jumped to closing on a greeting-stage call');
        scenarioPassed = false;
      }
      if (scenario.expectStage === 'objection' && stage === 'CONVERSION') {
        issues.push('AI detected false conversion on an objection');
        scenarioPassed = false;
      }

      if (issues.length > 0) {
        console.log(`  ISSUES: ${issues.join('; ')}`);
      }

      if (scenarioPassed) {
        console.log(`  RESULT: PASS`);
        passed++;
      } else {
        console.log(`  RESULT: FAIL`);
        failed++;
        failures.push({ name: scenario.name, issues, detection, heading, stage, script: script.substring(0, 80) });
      }
    } catch (err) {
      console.log(`  AI Error: ${err.message}`);
      failed++;
      failures.push({ name: scenario.name, issues: [err.message], detection });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${SCENARIOS.length}`);
  console.log(`${'='.repeat(80)}`);

  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) {
      console.log(`  ${f.name}`);
      console.log(`    Issues: ${f.issues.join('; ')}`);
      console.log(`    Detection: stage=${f.detection.callStage} agreed=${f.detection.hasAgreed} askedCallback=${f.detection.askedCallback}`);
      if (f.heading) console.log(`    AI: [${f.heading}] ${f.script}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
