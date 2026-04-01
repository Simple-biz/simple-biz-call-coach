const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const MODEL = 'claude-haiku-4-5-20251001';

// ============================================================================
// PRODUCTION PROMPT (must match claude-client-optimized.ts)
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

## ENGAGEMENT (follow-up questions for dry/short/unclear responses)
1. Discovery Question: "Do you currently have a website for your business, or is this something you've been thinking about setting up?"
2. Pain Point Probe: "What's been holding you back from getting a website going? Is it the cost, the time, or just not knowing where to start?"
3. Business Curiosity: "What kind of business do you run, if you don't mind me asking?"
4. Current Situation: "How are your customers finding you right now? Is it mostly word of mouth, or do you have something online?"
5. Gentle Re-engage: "I totally understand. A lot of business owners we talk to feel the same way at first. Are you open to just hearing what we could do for you real quick?"
6. Redirect Deflector: "I hear you. Would it be easier if I just had Bob or his partner give you a quick call later? It would be super quick, just so you know your options."
7. Not The Right Person: "No worries at all. Who would be the best person to talk to about the website? I can have Bob reach out to them directly."
8. Email Deflection: "Of course, we can definitely send some info over. What's the best email for you? And just so Bob knows who to follow up with, what's your name?"
9. How'd You Get My Number: "Great question — we're scouting small to medium local businesses in the area, so we just got your number off of Google. We're just reaching out to see if we can help."
10. Skeptical/Scam Concern: "Totally understand the caution. We're a legit local company here in [Location]. We just work with small businesses to help them get online. No pressure at all."

## CONVERSION (2 scripts)
1. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
2. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

const SYSTEM_PROMPT = `Sales coach for local digital services (SEO/web design). Target: small business owners. Goal: Get customer to agree to callback from Bob/partner.

YOUR TASK: Analyze recent transcript and select the SINGLE BEST script from Mark's library based on customer intent and conversation stage.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title (e.g., "Intro", "Ask Callback")
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION_HANDLING, CLOSING, CONVERSION, ENGAGEMENT
[CONTEXT]: One sentence explaining why (optional)
[SCRIPT]: ONLY the exact script text - NO rationale, NO explanation, NO value proposition text

CUSTOMER INTENT MATCHING RULES (PRIORITY ORDER):
1. Customer is AI assistant/voicemail -> USE: Quick Intro and suggest asking for human/callback
2. HIGHEST PRIORITY - Customer has AGREED to callback -> IMMEDIATELY switch to CONVERSION. Collect details. NEVER re-ask for callback.
3. Customer asks "Who is this?" -> USE: Basic Intro
4. Customer asks "What do you need?" or "I'm busy" -> USE: Affordable Hook
5. Customer says "We already have a website" or "Not interested" -> USE: Have One/Busy
6. After pitch AND objections handled AND customer has NOT yet agreed -> USE: Ask Callback
7. Customer asks about ownership/control -> USE: IP/Control Assurance
8. Customer asks "what do you need from me?" after agreeing -> USE: Get Email or Confirm Name
9. Customer gives a DRY, SHORT, or VAGUE response ("yeah", "I don't know", "maybe", "hmm", "I guess", "not sure", "send me an email", one-word answers) -> USE: An ENGAGEMENT script. Pick the one most relevant to the conversation context. Ask a follow-up question to keep the conversation going and learn about their business/needs.
10. Customer asks "How'd you get my number?" or sounds suspicious -> USE: How'd You Get My Number or Skeptical/Scam Concern from ENGAGEMENT
11. Customer says "I'm not the right person" or "Talk to someone else" -> USE: Not The Right Person from ENGAGEMENT
12. Customer says "Just send me an email" or "Send me info" -> USE: Email Deflection from ENGAGEMENT

STAGE DETERMINATION:
- If Stage field says CONVERSION -> TRUST IT ABSOLUTELY. Collect details only.
- For other stages, you MAY override based on transcript context.
- ENGAGEMENT: Use when customer is disengaged, giving dry answers, or the conversation is stalling. Your job is to ask a relevant question to re-engage them and learn about their needs.

SCRIPT SELECTION RULES:
- Use Mark's scripts as your foundation.
- You MAY add a brief custom sentence (1 sentence max) to acknowledge the customer's situation BEFORE a Mark script.
- For ENGAGEMENT scripts, pick the follow-up question most relevant to what the customer just said or the conversation context.
- Replace [Name] with customer's actual name, [Location] with actual city if known.
- Remove ALL filler words.
- Goal: Build rapport -> secure callback agreement`;

// ============================================================================
// 20 TEST SCENARIOS
// ============================================================================
const SCENARIOS = [
  {
    name: '1. Flat "yeah" after pitch',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz. We're local website designers here in Las Vegas." },
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website, since we're super affordable." },
      { s: 'caller', t: "Yeah." },
    ],
    expect: 'engagement/follow-up question'
  },
  {
    name: '2. "I don\'t know" — unsure customer',
    context: [
      { s: 'agent', t: "We're reaching out about your business website. Do you have a minute?" },
      { s: 'caller', t: "I don't know, what is this about exactly?" },
    ],
    expect: 'value prop or engagement'
  },
  {
    name: '3. "Maybe" — non-committal',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "Maybe. I'm not sure." },
    ],
    expect: 'engagement question'
  },
  {
    name: '4. "Send me an email" — deflection',
    context: [
      { s: 'agent', t: "Would you mind if I can have Bob give you a quick call later?" },
      { s: 'caller', t: "Just send me an email." },
    ],
    expect: 'email deflection — get email + pivot'
  },
  {
    name: '5. "How did you get my number?" — suspicious',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz." },
      { s: 'caller', t: "How did you get my number?" },
    ],
    expect: 'trust/source explanation'
  },
  {
    name: '6. "I\'m not the right person" — wrong contact',
    context: [
      { s: 'agent', t: "We're reaching out about your business website." },
      { s: 'caller', t: "I'm not the right person to talk to about that." },
    ],
    expect: 'ask who is the right person'
  },
  {
    name: '7. "Hmm" — minimal response after value prop',
    context: [
      { s: 'agent', t: "We're super affordable and we just don't want you to miss out at all." },
      { s: 'caller', t: "Hmm." },
    ],
    expect: 'engagement — re-engage or ask about their business'
  },
  {
    name: '8. "I guess" — lukewarm',
    context: [
      { s: 'agent', t: "Would you be open to hearing what we could do for your business?" },
      { s: 'caller', t: "I guess." },
    ],
    expect: 'engagement — ask about their needs'
  },
  {
    name: '9. "Is this a scam?" — trust issue',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz. We're local website designers." },
      { s: 'caller', t: "Is this a scam? How do I know you're legit?" },
    ],
    expect: 'skeptical/scam concern'
  },
  {
    name: '10. "Not right now" — soft rejection',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "Not right now." },
    ],
    expect: 'engagement — gentle re-engage or have one/busy'
  },
  {
    name: '11. One-word "no" then silence',
    context: [
      { s: 'agent', t: "Do you currently have a website?" },
      { s: 'caller', t: "No." },
    ],
    expect: 'follow-up — pain point probe or ask what kind of business'
  },
  {
    name: '12. "What do you guys charge?" — pricing without context',
    context: [
      { s: 'agent', t: "We're local website designers here in Las Vegas." },
      { s: 'caller', t: "What do you guys charge?" },
    ],
    expect: 'value pricing redirect to Bob callback'
  },
  {
    name: '13. "We had a bad experience with a web company" — burnt before',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "We had a bad experience with a web company before. I'm hesitant." },
    ],
    expect: 'engagement — empathy + IP/control assurance or gentle re-engage'
  },
  {
    name: '14. "My nephew does my website" — informal objection',
    context: [
      { s: 'agent', t: "We're reaching out about your business website." },
      { s: 'caller', t: "My nephew does my website for me." },
    ],
    expect: 'objection handling — SEO pivot or revamp'
  },
  {
    name: '15. "I\'m driving right now" — bad timing',
    context: [
      { s: 'agent', t: "Do you have a minute?" },
      { s: 'caller', t: "I'm driving right now, can't really talk." },
    ],
    expect: 'engagement — redirect to callback for better time'
  },
  {
    name: '16. "We use social media instead" — alternative to website',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "We just use Instagram and Facebook. Don't really need a website." },
    ],
    expect: 'engagement or objection — digital marketing pivot + why website matters'
  },
  {
    name: '17. "How long does it take?" — timeline question',
    context: [
      { s: 'agent', t: "We build and optimize websites for local businesses." },
      { s: 'caller', t: "How long does it take to build a website?" },
    ],
    expect: 'custom context + redirect to Bob for details'
  },
  {
    name: '18. Dead silence after intro — no response',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz. We're local website designers here in Las Vegas. Do you have a minute?" },
      { s: 'caller', t: "..." },
    ],
    expect: 'engagement — gentle re-engage or repeat intro'
  },
  {
    name: '19. "Put me on the do not call list" — hard rejection',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz." },
      { s: 'caller', t: "Put me on the do not call list. Don't call me again." },
    ],
    expect: 'respectful acknowledgment — do NOT push'
  },
  {
    name: '20. "Yeah whatever, go ahead" — apathetic agreement',
    context: [
      { s: 'agent', t: "Would you mind if I can have Bob or his partner give you a quick call later to talk about your website?" },
      { s: 'caller', t: "Yeah whatever, go ahead." },
    ],
    expect: 'conversion — collect details (they said yes)'
  },
];

// ============================================================================
// RUN
// ============================================================================
async function callClaude(stage, context, count) {
  const userPrompt = `Stage: ${stage}\nTranscript Count: ${count}\n\nRecent Conversation:\n${context}`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 150, temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT }, { type: 'text', text: MARKS_GOLDEN_SCRIPTS }],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function main() {
  console.log('='.repeat(80));
  console.log('DRY ANSWER / FOLLOW-UP QUESTION TEST — 20 SCENARIOS');
  console.log('='.repeat(80));

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const context = sc.context.map(c => `${c.s.toUpperCase()}: "${c.t}"`).join('\n');
    const count = sc.context.length;
    let stage = count < 5 ? 'greeting' : count < 10 ? 'discovery' : count < 20 ? 'objection' : 'closing';

    // Check for conversion (scenario 20)
    const callerMsgs = sc.context.filter(c => c.s === 'caller').map(c => c.t.toLowerCase());
    const agentMsgs = sc.context.filter(c => c.s === 'agent').map(c => c.t.toLowerCase());
    const agreed = callerMsgs.some(m => ['yes','sure','yeah','go ahead','whatever'].some(s => m.includes(s)));
    const askedCb = agentMsgs.some(m => ['call later','quick call','bob or his partner'].some(p => m.includes(p)));
    if (agreed && askedCb) stage = 'conversion';

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${sc.name}`);
    console.log(`Expected: ${sc.expect}`);
    console.log(`Stage: ${stage} | Transcripts: ${count}`);
    console.log(`${'─'.repeat(80)}`);

    // Show convo
    for (const c of sc.context) {
      console.log(`  ${c.s === 'agent' ? 'AGENT' : 'CUSTOMER'}: "${c.t}"`);
    }

    try {
      const raw = await callClaude(stage, context, count);
      const heading = raw.match(/\[HEADING\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '?';
      const stg = raw.match(/\[STAGE\]:\s*(\w+)/i)?.[1]?.trim() || '?';
      const ctxLine = raw.match(/\[CONTEXT\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '';
      const script = raw.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim().replace(/^["']|["']$/g, '') || '?';

      console.log(`\n  >> [${heading}] (${stg})`);
      if (ctxLine) console.log(`     Why: ${ctxLine}`);
      console.log(`     "${script.substring(0, 150)}${script.length > 150 ? '...' : ''}"`);
    } catch (e) {
      console.log(`  >> ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('DONE — 20 SCENARIOS');
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
