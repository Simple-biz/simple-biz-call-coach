# Call Coach — AI Coaching Test Results

**Date:** April 3, 2026  
**Infrastructure:** AWS Live (us-east-1)  
**Model:** Claude Haiku 4.5 (haiku-only)  
**WebSocket:** `wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production`

---

## Results: 8/8 Passing ✅

| # | Scenario | Stage | Heading | Result |
|---|----------|-------|---------|--------|
| 1 | Greeting — "Who is this?" | GREETING | Who Is This | ✅ |
| 2 | Discovery — Agent already introduced | VALUE_PROP | Bob Transition | ✅ |
| 3 | SEO Problem — Website inactive | OBJECTION_HANDLING | SEO Problem Empathy | ✅ |
| 4 | Conversion — Agrees + gives 4PM | CONVERSION | Confirm Details | ✅ |
| 5 | Decline — "Not interested" | SIGNOFF | Respect Decline | ✅ |
| 6 | Pricing — "How much?" | VALUE_PROP | Pricing Redirect | ✅ |
| 7 | Busy — "I'm busy right now" | GREETING | Busy Redirect | ✅ |
| 8 | Signoff — All info collected | SIGNOFF | Sign Off | ✅ |

---

## Detailed Responses

### 1. GREETING — Customer says "Who is this?"

**Transcript:**
> **Customer:** Who is this?

**AI Tip:**
- **Heading:** Who Is This
- **Stage:** GREETING
- **Script:** "My name is [Agent], and my partner Bob and I are here; we're local website designers here in [Location]. Do you currently have a website for your business, or is this something you've been thinking about?"
- **Context:** Customer asking for identification at the start of the call — agent needs to introduce themselves and establish purpose.

---

### 2. DISCOVERY — Agent already introduced, customer says "tell me about it"

**Transcript:**
> **Agent:** Hi, this is Kayser from Simple Biz. I'm reaching out about your business website. Do you have a minute?  
> **Customer:** Yeah sure Kayser. Tell me about it.

**AI Tip:**
- **Heading:** Bob Transition
- **Stage:** VALUE_PROP
- **Script:** "My partner Bob and I are local website designers here. What kind of business do you run, if you don't mind me asking?"
- **Context:** Agent already introduced themselves by name (Kayser), so skip repeating the intro. Customer said "Tell me about it" — open invitation. Bring up Bob naturally and ask an engagement question to keep momentum.

---

### 3. SEO PROBLEM — Customer describes website SEO issues

**Transcript:**
> **Agent:** That's awesome. Do you currently have a website?  
> **Customer:** Yeah I have one but it's not showing up on Google. My SEO is terrible and the site is basically dead.

**AI Tip:**
- **Heading:** SEO Problem Empathy
- **Stage:** OBJECTION_HANDLING
- **Script:** "Oh, I hear you — SEO can be tricky. That's actually what we specialize in. Would you mind if my partner Bob gives you a quick call to walk you through some options?"
- **Context:** Customer described a specific problem (poor SEO, site not ranking on Google). Agent needs to empathize with the problem, not dismiss it as "awesome", then pivot to callback.

---

### 4. CONVERSION — Customer agrees to callback + gives time

**Transcript:**
> **Agent:** Would you mind if my partner Bob gives you a quick call to show you how?  
> **Customer:** Yeah definitely. But I'm busy right now, can we do tomorrow at 4PM?

**AI Tip:**
- **Heading:** Confirm Details
- **Stage:** CONVERSION
- **Script:** "Perfect, so Bob will call you tomorrow at 4PM. What's the best number to reach you at, and what's your name?"
- **Context:** Customer agreed to callback at 4PM tomorrow but agent hasn't collected their name or contact number yet. Must gather these details before sign-off.

---

### 5. DECLINE — Customer says "not interested"

**Transcript:**
> **Agent:** Hi, this is Kayser from Simple Biz. I'm reaching out about your business website.  
> **Customer:** I'm not interested. Thanks though.

**AI Tip:**
- **Heading:** Respect Decline
- **Stage:** SIGNOFF
- **Script:** "No problem. I do appreciate you taking my call. Have a great day."
- **Context:** Customer clearly stated "I'm not interested" — this is a firm decline that must be respected per protocol.

---

### 6. PRICING — Customer asks how much it costs

**Transcript:**
> **Agent:** Hi, this is Kayser from Simple Biz. My partner Bob and I build websites for local businesses.  
> **Customer:** Okay, how much does a website cost?

**AI Tip:**
- **Heading:** Pricing Redirect
- **Stage:** VALUE_PROP
- **Script:** "We're super affordable — my partner Bob can get into the details with you on that, if you'd let him give you a quick call later today. Does that sound good?"
- **Context:** Customer asked about pricing immediately after intro. Agent needs to redirect to Bob for pricing details while keeping conversation moving.

---

### 7. BUSY — Customer says "I'm busy right now"

**Transcript:**
> **Agent:** Hi, this is Kayser from Simple Biz. I'm reaching out about your business website. Do you have a minute?  
> **Customer:** Not really, I'm pretty busy right now.

**AI Tip:**
- **Heading:** Busy Redirect
- **Stage:** GREETING
- **Script:** "No worries at all — I know you're busy. Would it be easier if I just had my partner Bob give you a quick call later when things calm down? Should be super quick."
- **Context:** Customer is busy and hasn't fully engaged yet. Need to acknowledge their time constraint and pivot to a callback offer rather than pushing for immediate conversation.

---

### 8. SIGNOFF — Customer already gave name + time + number

**Transcript:**
> **Agent:** Got it. And what time works best?  
> **Customer:** Tomorrow around 2 works.

**AI Tip:**
- **Heading:** Sign Off
- **Stage:** SIGNOFF
- **Script:** "Perfect, Maria! Bob will call you tomorrow at 2. Have a beautiful day and I'm super excited for you. Take care!"
- **Context:** Customer agreed to callback, provided phone number and time (tomorrow at 2 PM). Agent should confirm details and close warmly without asking for more info.

---

## Key Fixes Applied

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Generic/wrong tips after 15+ transcripts | Sonnet model ID `claude-sonnet-4-5-20251001` doesn't exist → 404 → fallback | Switched to Haiku-only (faster, cheaper, reliable) |
| Agent name repeated in discovery | Quick Intro script re-introduces name | Added "Bob Transition" script that skips agent name |
| "That's great" for SEO problems | No empathy script existed | Added SEO Problem Empathy script + TONE pre-rule |
| Ignored customer's proposed time | No time-acknowledgment rule | Added Rule 2 sub-rule: acknowledge time in conversion |
| Stale tips mid-call | 30s cache TTL | Reduced to 5s TTL |
| Wrong stage detection | Raw transcript row count ≠ conversation turns | Turn-based detection (speaker changes) |
