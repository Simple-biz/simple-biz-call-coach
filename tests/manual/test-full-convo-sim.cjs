const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-haiku-4-5-20251001';

// ============================================================================
// COACHING PROMPT (production copy)
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

const COACH_PROMPT = `Sales coach for local digital services (SEO/web design). Target: small business owners. Goal: Get customer to agree to callback from Bob/partner.

YOUR TASK: Analyze recent transcript and select the SINGLE BEST script from Mark's library based on customer intent and conversation stage.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION_HANDLING, CLOSING, CONVERSION, ENGAGEMENT, SIGNOFF
[SCRIPT]: ONLY the spoken words the agent should say

CUSTOMER INTENT MATCHING RULES (PRIORITY ORDER):
1. Customer is AI assistant/voicemail -> Quick Intro + ask for human/callback
2. HIGHEST PRIORITY - Customer AGREED to callback, BUT ONLY if the agent ALREADY ASKED for one:
   - Agent asked "Would you mind if Bob calls?" AND customer said "yes", "sure", "sounds good", "okay", "go ahead"
   - OR customer proactively says "have Bob call me", "call me back", "they can call me"
   - A casual "yeah" or "okay" at the START of a call is NOT agreement — just being polite.
   -> When truly agreed: switch to CONVERSION. Collect details. NEVER re-pitch.
3. Customer is FRUSTRATED ("you're going in circles", "you keep saying the same thing", "I already told you", "I'm done", "you're not listening") -> STOP pitching. Acknowledge frustration, pivot to callback or details. If also asking a question -> ANSWER it first.
14. Customer asks about PRICING, COST, or TIMELINE -> USE: Value Pricing + Ask Callback or Pricing/Samples. Redirect pricing details to Bob.
4. "Who is this?" -> Basic Intro
5. "What do you need?" / "I'm busy" -> Affordable Hook
6. "We already have a website" / "Not interested" -> Have One/Busy
7. After pitch + objections handled, customer NOT agreed -> Ask Callback
8. Ownership/control question -> IP/Control Assurance
9. "What do you need from me?" after agreeing -> Get Email or Confirm Name
10. DRY/SHORT/VAGUE response -> ENGAGEMENT script. Ask a relevant follow-up question.
11. "How'd you get my number?" / suspicious -> Trust/Source or Skeptical/Scam Concern
12. "I'm not the right person" -> Not The Right Person
13. "Just send me an email" -> Email Deflection
14. Customer asks a DIRECT QUESTION agent can't answer (pricing, timeline, features) -> Acknowledge the question, then redirect to Bob callback.

STAGE DETERMINATION:
- CONVERSION -> TRUST IT. But check: has customer ALREADY given name/number/email in the transcript? If YES -> use Sign Off. Do NOT re-ask for info they already provided. If customer says "I already gave you that" during CONVERSION -> Sign Off IMMEDIATELY.
- ENGAGEMENT: Customer disengaged or giving dry answers. Ask follow-up questions.
- Other stages: override based on transcript context.

SCRIPT SELECTION:
- ALWAYS pick the golden script that best matches what the customer said.
- If a golden script DIRECTLY fits -> use it as-is.
- If NO golden script directly fits -> add ONE short acknowledgment sentence (max 15 words) showing you heard them, THEN land on the closest golden script.
  - Example: "A lot of local businesses felt the same way." + SEO Pivot or Ask Callback
- Do NOT write full custom paragraphs. Do NOT explain what websites do — that's Bob's job.
- Agent's job: introduce -> pitch affordability -> handle objections -> secure callback -> collect details.
- For PRICING: First time -> Pricing/Samples. If customer pushes again -> Pricing Ballpark ("most of our sites run just a few hundred, not thousands"). Do NOT dodge the same question twice.

ANTI-REPETITION (CRITICAL):
- Look at what the AGENT already said. Do NOT suggest a script covering the same ground.
- If agent already pitched SEO -> do NOT suggest another SEO script. Move to a DIFFERENT angle.
- If agent already asked for callback -> do NOT ask again. Collect details or try different close.
- If agent said "affordable" or "SEO" 2+ times -> MUST pivot to completely different approach.
- Each suggestion should ADVANCE the conversation, not repeat it.

FRUSTRATION DETECTION:
- If customer says "you're repeating", "I'm done", "you're going in circles", "not listening", "I already gave you that", "I already told you" -> FRUSTRATED.
- If frustrated DURING CONVERSION (customer already gave details): use Sign Off IMMEDIATELY. Example: "Got it! Bob will call you at [time]. Have a beautiful day and I'm super excited for you. Take care!"
- If frustrated BEFORE CONVERSION: stop pitching, acknowledge, pivot to Ask Callback.
- Be direct, not salesy. Get to the point fast.`;

// ============================================================================
// CUSTOMER SIMULATOR PROMPT
// ============================================================================
const CUSTOMER_PROMPT = `You are Maria, a 42-year-old woman who owns a small landscaping business called "Green Touch Landscaping" in Henderson, Nevada (near Las Vegas). You have 3 employees.

YOUR SITUATION:
- You do NOT have a website. You've been getting customers through word of mouth and Nextdoor posts.
- You've been thinking about getting a website but don't know where to start and are worried about cost.
- You're a bit skeptical of cold calls but not rude.
- You're on the job site right now so you're slightly distracted.

YOUR PERSONALITY:
- Start off giving short, dry answers (you're busy and skeptical)
- Gradually warm up as the agent shows they understand your business
- You have real questions: cost, timeline, what the website would look like
- If the agent asks good questions about your business, you open up more
- If the agent just pushes the pitch without caring about you, you shut down
- You eventually agree to a callback if the agent handles things well

RULES:
- Respond naturally as Maria would. 1-3 sentences max per response.
- Don't be overly friendly at the start. You're busy and didn't expect this call.
- Show your personality — you're practical, no-nonsense, but fair.
- If the agent asks about your business, share details naturally.
- Output ONLY Maria's spoken words. No stage directions or descriptions.`;

// ============================================================================
// API CALLS
// ============================================================================
async function getCoachTip(transcript, stage, count, previousSuggestions = []) {
  const context = transcript.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n');
  // Take the LAST 1200 chars (most recent messages), not the first
  let userPrompt = `Stage: ${stage}\nTranscript Count: ${count}\n\nRecent Conversation:\n${context.length > 1200 ? context.slice(-1200) : context}`;

  if (previousSuggestions.length > 0) {
    const prevList = previousSuggestions.slice(-5).map((s, i) => `${i + 1}. "${s.substring(0, 80)}"`).join('\n');
    userPrompt += `\n\n⚠️ ALREADY SUGGESTED (do NOT repeat these — pick a DIFFERENT script):\n${prevList}`;
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: HAIKU, max_tokens: 150, temperature: 0.3,
      system: [{ type: 'text', text: COACH_PROMPT }, { type: 'text', text: MARKS_GOLDEN_SCRIPTS }],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content[0].text;
  const heading = raw.match(/\[HEADING\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '?';
  const stg = raw.match(/\[STAGE\]:\s*(\w+)/i)?.[1]?.trim() || '?';
  let script = raw.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim() || '?';
  // Strip reasoning/explanation that leaks after the script
  script = script.split(/\n\s*[-—*#]/)[0].trim();
  script = script.split(/\n\s*\*\*/)[0].trim();
  script = script.split(/\s*---/)[0].trim();
  script = script.split(/\s*(?:Rationale|Reasoning|REASONING|Value proposition|Explanation|Note|Why):/i)[0].trim();
  script = script.replace(/^["']|["']$/g, '');
  return { heading, stage: stg, script };
}

async function getCustomerResponse(transcript) {
  const convo = transcript.map(t => {
    const role = t.speaker === 'agent' ? 'Agent (Caesar)' : 'Maria';
    return `${role}: ${t.text}`;
  }).join('\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: SONNET, max_tokens: 100, temperature: 0.7,
      system: [{ type: 'text', text: CUSTOMER_PROMPT }],
      messages: [{ role: 'user', content: `Here is the conversation so far:\n\n${convo}\n\nRespond as Maria. Keep it natural and short (1-3 sentences).` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text.trim().replace(/^(Maria:\s*)/i, '');
}

function detectStage(transcript) {
  const count = transcript.length;
  let stage;
  if (count < 5) stage = 'greeting';
  else if (count < 10) stage = 'discovery';
  else if (count < 20) stage = 'objection';
  else stage = 'closing';

  const recent = transcript.slice(-10);
  const callerMsgs = recent.filter(t => t.speaker === 'caller').map(t => t.text.toLowerCase());
  const agentMsgs = recent.filter(t => t.speaker === 'agent').map(t => t.text.toLowerCase());
  const directAgreement = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "that's fine", "that works", "go ahead", "let's do it"];
  const indirectAgreement = ['have bob call', 'call me back', 'they can call', 'have them call', 'bob can call', 'give me a call', "i'll take a call", "take a call from bob", "he can call", "bob call me", "can call me"];
  const directlyAgreed = callerMsgs.some(msg => directAgreement.some(s => msg.includes(s)));
  const indirectlyAgreed = callerMsgs.some(msg => indirectAgreement.some(s => msg.includes(s)));
  const callbackPatterns = ['call later', 'quick call', 'call you back', 'give you a call', 'bob or his partner'];
  const askedCb = agentMsgs.some(msg => callbackPatterns.some(p => msg.includes(p)));
  if ((directlyAgreed && askedCb) || indirectlyAgreed) {
    stage = 'conversion';

    // Check if customer already gave details → force sign-off
    const namePattern = /my name is|it's \w+|i'm \w+|ask for \w+|call me \w+/i;
    const timePattern = /after \d|before \d|around \d|at \d|this afternoon|this evening|tomorrow/i;
    const alreadyToldYou = /already (said|gave|told)|i got it|yeah yeah/i;

    const gaveName = callerMsgs.some(msg => namePattern.test(msg));
    const gaveTime = callerMsgs.some(msg => timePattern.test(msg));
    const frustrated = callerMsgs.some(msg => alreadyToldYou.test(msg));

    if ((gaveName && gaveTime) || frustrated) {
      stage = 'signoff';
      console.log(`  [SIGNOFF DETECTED] name=${gaveName} time=${gaveTime} frustrated=${frustrated}`);
    }
  }
  return stage;
}

// ============================================================================
// SIMULATION
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('FULL CONVERSATION SIMULATION');
  console.log('Agent: Caesar (Simple.Biz) | Customer: Maria (Green Touch Landscaping)');
  console.log('='.repeat(80));

  const transcript = [];
  const MAX_TURNS = 12;
  const previousSuggestions = [];

  // Agent opens
  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`\n  AGENT: "${opener}"`);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // 1. Customer responds
    const customerResponse = await getCustomerResponse(transcript);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  CUSTOMER: "${customerResponse}"`);

    // Check for hard end signals
    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('take care') || lower.includes('talk to you later') || lower.includes('have a good') || lower.includes('gotta go') || lower.includes('hangs up') || lower.includes('phone is off')) {
      console.log('\n  [Call ended by customer]');
      break;
    }

    // 2. Get coaching tip
    const stage = detectStage(transcript);
    const tip = await getCoachTip(transcript, stage, transcript.length, previousSuggestions);
    console.log(`\n  >> AI COACH [${tip.heading}] (${tip.stage}):`);
    console.log(`     "${tip.script.substring(0, 200)}"`);

    // Track suggestion
    previousSuggestions.push(tip.script);

    // 3. Agent "follows" the tip (use it as agent's next line)
    // Personalize: replace placeholders
    let agentLine = tip.script
      .replace(/\[Agent\]/g, 'Caesar')
      .replace(/\[Location\]/g, 'Las Vegas')
      .replace(/\[Name\]/g, 'Maria');

    // Truncate if too long
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';

    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    // Check if we're in sign-off territory
    if (stage === 'signoff' || (tip.stage === 'SIGNOFF') || (tip.script.toLowerCase().includes('have a beautiful day') || tip.script.toLowerCase().includes('take care') || tip.script.toLowerCase().includes('super excited for you'))) {
      console.log('\n  [Agent signed off — call complete]');
      break;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Print full transcript
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FULL TRANSCRIPT');
  console.log('='.repeat(80));
  const startTime = new Date();
  startTime.setHours(10, 30, 0, 0);
  transcript.forEach((t, i) => {
    const time = new Date(startTime.getTime() + i * 5000);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = t.speaker === 'agent' ? 'You' : 'Customer';
    console.log(`\n[${timeStr}] ${label}: ${t.text}`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total exchanges: ${transcript.length} | Agent: ${transcript.filter(t=>t.speaker==='agent').length} | Customer: ${transcript.filter(t=>t.speaker==='caller').length}`);
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
