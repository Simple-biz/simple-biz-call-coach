const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

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

STAGE DETERMINATION:
- If Stage field says CONVERSION -> TRUST IT ABSOLUTELY. The system has already confirmed the customer agreed. Do NOT re-analyze or downgrade to CLOSING. The callback is ALREADY secured - your ONLY job now is to collect details (name, email, confirm authority) or sign off. If you output "Ask Callback" or "Soft Close" when Stage is CONVERSION, you have FAILED.
- For all other stages, you MAY override if the transcript clearly shows a different stage:
  - GREETING: First 1-2 exchanges, no pitch given yet
  - VALUE_PROP: Intro done, customer asking what you want, pitch not fully delivered
  - OBJECTION_HANDLING: Customer expressed resistance/objection/has existing solution
  - CLOSING: Pitch delivered, objections handled, time to ask for callback
  - CONVERSION: Customer agreed. Collect info or sign off. NEVER go back.

SCRIPT SELECTION RULES:
- Use Mark's scripts as your foundation - they are proven and effective.
- You MAY add a brief custom sentence (1 sentence max) to acknowledge the customer's specific situation (their industry, question, or concern) BEFORE transitioning into a Mark script.
- Example: Customer asks "Can you do painting websites?" -> "Absolutely, we work with all kinds of local service businesses including painting companies." + then a Mark script like Ask Callback or Local Emphasis.
- Replace [Name] with customer's actual name, [Location] with actual city if known.
- Remove ALL filler words: "uh", "uhm", "ah", "you know", "I mean", "Oh"
- Keep Mark's wording intact when using his scripts - do not paraphrase.
- Goal: Build rapport -> secure callback agreement`;

// ============================================================================
// CONVERSION DETECTION (mirrors production)
// ============================================================================
function detectStage(transcripts) {
  const count = transcripts.length;
  let callStage;
  if (count < 5) callStage = 'greeting';
  else if (count < 10) callStage = 'discovery';
  else if (count < 20) callStage = 'objection';
  else callStage = 'closing';

  const recent = transcripts.slice(0, 10); // DESC order, newest first
  const customerMsgs = recent.filter(t => t.speaker === 'caller').map(t => t.text.toLowerCase());
  const agentMsgs = recent.filter(t => t.speaker === 'agent').map(t => t.text.toLowerCase());

  const signals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "i'm good with that", "that's great", "that's fine", "that works", "i'm down", "i'm interested", "go ahead", "let's do it", "fine"];
  const hasAgreed = customerMsgs.some(msg => signals.some(s => msg.includes(s)));
  // Must match callback-ask patterns, not just any mention of "Bob"
  const callbackPatterns = ['call later', 'callback', 'quick call', 'call you back', 'give you a call', 'bob or his partner'];
  const askedCallback = agentMsgs.some(msg => callbackPatterns.some(p => msg.includes(p)));

  if (hasAgreed && askedCallback) callStage = 'conversion';
  return callStage;
}

// ============================================================================
// CLAUDE API CALL
// ============================================================================
async function callClaude(stage, context, count) {
  const userPrompt = `Stage: ${stage}\nTranscript Count: ${count}\n\nRecent Conversation:\n${context.substring(0, 800)}`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: HAIKU_MODEL, max_tokens: 150, temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT }, { type: 'text', text: MARKS_GOLDEN_SCRIPTS }],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content[0].text;
  const heading = text.match(/\[HEADING\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '';
  const stg = text.match(/\[STAGE\]:\s*(\w+)/i)?.[1]?.trim() || '';
  const script = text.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
  return { heading, stage: stg, script };
}

// ============================================================================
// SIMULATE A PAINTING BUSINESS CALL — step by step
// ============================================================================
const CALL_STEPS = [
  // Step 1: Greeting
  [
    { speaker: 'agent', text: 'Hi, this is Caesar from Simple.Biz. I\'m reaching out about your business website. Do you have a minute?' },
  ],
  // Step 2: Customer responds — painting business owner
  [
    { speaker: 'caller', text: 'Yeah, who is this? What\'s this about?' },
  ],
  // Step 3: Agent intro
  [
    { speaker: 'agent', text: 'My name is Caesar, and Bob and I are here. We\'re local website designers here in Las Vegas.' },
  ],
  // Step 4: Customer shows interest — mentions painting biz
  [
    { speaker: 'caller', text: 'Oh okay. Yeah I actually run a painting company here in town.' },
    { speaker: 'caller', text: 'We\'ve been wanting to get a website set up for a while now.' },
  ],
  // Step 5: Agent delivers value prop
  [
    { speaker: 'agent', text: 'We\'re just wondering if you\'re interested in building or updating your website, since we\'re super affordable. Just don\'t want you to miss out at all.' },
  ],
  // Step 6: Customer asks details
  [
    { speaker: 'caller', text: 'Yeah we definitely need one. We\'ve been getting leads from word of mouth but I know a website would help.' },
    { speaker: 'caller', text: 'What kind of websites do you guys build? Can you do something for a painting company?' },
  ],
  // Step 7: Agent handles — local emphasis
  [
    { speaker: 'agent', text: 'That\'s why we\'re here, because we\'re just trying to keep everything local here in Las Vegas.' },
    { speaker: 'agent', text: 'We work with all kinds of local businesses, painting companies included.' },
  ],
  // Step 8: Customer asks about cost
  [
    { speaker: 'caller', text: 'Alright that sounds good. How much does something like that run?' },
  ],
  // Step 9: Agent asks for callback
  [
    { speaker: 'agent', text: 'Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?' },
    { speaker: 'agent', text: 'So then you can know pricing and all that.' },
  ],
  // Step 10: Customer agrees!
  [
    { speaker: 'caller', text: 'Yeah sure, that sounds good. Have them call me.' },
    { speaker: 'caller', text: 'What do you need from me?' },
  ],
  // Step 11: Agent collects info
  [
    { speaker: 'agent', text: 'And your name is?' },
  ],
  // Step 12: Customer gives name
  [
    { speaker: 'caller', text: 'It\'s Mike. Mike Rodriguez. I\'m the owner.' },
  ],
  // Step 13: Agent wraps up
  [
    { speaker: 'agent', text: 'What\'s your email, Mike?' },
  ],
  // Step 14: Customer gives email
  [
    { speaker: 'caller', text: 'mike@rodriguezpainting.com' },
  ],
];

async function main() {
  console.log('='.repeat(80));
  console.log('PAINTING BUSINESS OWNER — FULL CALL SIMULATION');
  console.log('='.repeat(80));

  const allTranscripts = []; // Chronological
  let stepNum = 0;

  for (const stepMessages of CALL_STEPS) {
    stepNum++;
    // Add new messages
    for (const msg of stepMessages) {
      allTranscripts.push(msg);
    }

    // Build DESC order (like Postgres returns)
    const descTranscripts = [...allTranscripts].reverse();
    const stage = detectStage(descTranscripts);

    // Build chronological context for AI (like production does)
    const recentChronological = descTranscripts.slice(0, 15).reverse();
    const context = recentChronological.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n');

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`STEP ${stepNum} | ${allTranscripts.length} transcripts | Stage: ${stage.toUpperCase()}`);
    console.log(`${'─'.repeat(80)}`);

    // Show new messages
    for (const msg of stepMessages) {
      const label = msg.speaker === 'agent' ? 'AGENT' : 'CUSTOMER';
      console.log(`  ${label}: "${msg.text}"`);
    }

    // Get AI suggestion
    try {
      const tip = await callClaude(stage, context, allTranscripts.length);
      console.log(`\n  >> AI TIP [${tip.heading}] (${tip.stage}):`);
      console.log(`     "${tip.script}"`);
    } catch (e) {
      console.log(`  >> AI ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('CALL COMPLETE');
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
