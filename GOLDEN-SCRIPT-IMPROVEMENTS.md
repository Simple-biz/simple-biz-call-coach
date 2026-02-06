# Golden Script Context-Aware Improvements

## 🎯 Goal

AI suggestions should be **80%+ from Mark's Golden Script Library** with **minor contextual adjustments** for rapport building. The goal is to guide every conversation toward getting the customer to agree to a callback from Bob/partner.

---

## 📋 What Was Updated

### 1. **Cleaned Golden Scripts** (Removed Filler Words)

**BEFORE (Had Filler Words):**
```
"I mean, that's great because we also optimize websites..."
"Oh okay. I mean, that's great because..."
"Of course yeah. I mean, I was just about to say..."
```

**AFTER (Clean & Professional):**
```
"That's great because we also optimize websites..."
"Oh okay. That's great because..."
"Of course yeah. I was just about to say..."
```

**Removed:**
- "I mean" at sentence starts
- "uh", "uhm", "ah"
- "you know"
- Unnecessary hesitations

**Kept:**
- Natural conversation starters ("Oh", "Yeah", "Of course")
- Mark's proven phrasing and structure
- Persuasive elements (FOMO, validation, local emphasis)

---

### 2. **Enhanced Claude Prompt** (Context-Aware Instructions)

**NEW PROMPT RULES:**

```
RULES - CONTEXT-AWARE PERSONALIZATION:
- Pick the ONE best script that fits the situation
- Keep 80%+ of Mark's proven wording EXACTLY as written
- Make MINOR adjustments ONLY for:
  1. Customer name (if mentioned in transcript, replace [Name] with their actual name)
  2. Emotion awareness (if customer sounds frustrated: add "I understand" / if excited: add enthusiasm)
  3. Location (replace [Location] with actual city if known)
- Remove ALL filler words: "uh", "uhm", "ah", "you know", "I mean" at sentence starts
- Keep natural flow - sound conversational, not robotic
- Goal: Build rapport → secure callback agreement
```

---

## 🎭 How Context-Aware Personalization Works

### Example 1: Customer Name Insertion

**Golden Script (Template):**
```
"And [Name], you're the person in charge of the website we could talk to, right?"
```

**Live Transcript Context:**
```
Customer: "This is John speaking."
```

**AI Output (Personalized):**
```
"And John, you're the person in charge of the website we could talk to, right?"
```

---

### Example 2: Emotion Awareness

**Golden Script:**
```
"That's great because we also optimize websites as well, especially with SEO."
```

**Live Transcript Context:**
```
Customer: "I already have a website and I'm frustrated with how slow it is!"
```

**AI Output (Emotion-Aware):**
```
"I understand - that's great because we also optimize websites as well, especially with SEO and site speed."
```

---

### Example 3: Location Personalization

**Golden Script:**
```
"We're local website designers here in [Location]."
```

**Agent Context:**
```
Agent is based in Miami, FL
```

**AI Output:**
```
"We're local website designers here in Miami."
```

---

## 📊 Golden Script Flow (Call Structure)

```
1. GREETING
   └─> Audio check → Intro with location

2. VALUE_PROP
   └─> Affordable hook → Local emphasis → Active listening

3. OBJECTION_HANDLING
   ├─> "I have a website" → SEO Pivot
   ├─> "Not interested" → Have One/Busy?
   ├─> Concerns about control → IP/Control Assurance
   └─> Digital marketing needs → Full Service Pivot

4. CLOSING (⭐ GOAL: Secure Callback)
   ├─> Ask Callback (primary goal)
   ├─> Get Email
   ├─> Confirm Name & Decision Maker
   ├─> Value Pricing (benefit of call)
   └─> FOMO reinforcement

5. CONVERSION
   └─> Sign Off (enthusiastic, sets expectation)
```

---

## ✅ Expected AI Suggestion Behavior

### What You'll See:

1. **Selection:** Claude picks most relevant script from Mark's 28 proven patterns
2. **Personalization:** Replaces `[Name]`, `[Agent]`, `[Location]` with actual values
3. **Emotion Handling:** Adds brief acknowledgment if customer shows strong emotion
4. **Clean Output:** No "uh", "uhm", "I mean" at sentence starts
5. **Proven Wording:** 80%+ matches Mark's exact phrasing
6. **Goal-Oriented:** Always moves toward callback agreement

---

## 📝 Example Outputs

### Scenario 1: Customer Has Website

**Transcript:**
```
CUSTOMER: "We already have a website, thanks."
```

**AI Suggestion:**
```
HEADING: SEO Pivot
STAGE: OBJECTION_HANDLING
CONTEXT: Customer has existing site, pivot to optimization
SCRIPT: That's great that you already have one because we also optimize websites as well, especially with SEO.
```

---

### Scenario 2: Customer Interested, Move to Close

**Transcript:**
```
CUSTOMER: "Yeah, we've been thinking about updating our site."
AGENT: "Great! We're super affordable."
CUSTOMER: "That sounds good."
```

**AI Suggestion:**
```
HEADING: Ask Callback
STAGE: CLOSING
CONTEXT: Customer shows interest, time to secure callback
SCRIPT: Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?
```

---

### Scenario 3: Customer Asks About Ownership

**Transcript:**
```
CUSTOMER: "Do I own the website or do you guys control it?"
```

**AI Suggestion:**
```
HEADING: IP Assurance
STAGE: OBJECTION_HANDLING
CONTEXT: Addressing ownership concern
SCRIPT: Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business.
```

---

## 🚀 Deployment

**Lambda Function Updated:**
- `DevAssistWebSocketStack-IntelligenceHandler`
- File: `infra/lib/lambda/shared/claude-client-optimized.ts`
- Changes:
  1. Cleaned Golden Scripts (removed filler words)
  2. Enhanced system prompt (context-aware rules)
  3. Added goal emphasis (callback agreement)

**Deployment Command:**
```bash
cd infra && npm run deploy
```

---

## 🧪 Testing

**Test Scenarios:**

1. **Greeting Stage**
   - Start call
   - Click "Get Next Suggestion"
   - Should suggest: Audio check or Basic intro

2. **Objection Stage**
   - Customer says "I have a website"
   - Click "Get Next Suggestion"
   - Should suggest: SEO Pivot or Revamp Pivot

3. **Closing Stage**
   - Customer shows interest
   - Click "Get Next Suggestion"
   - Should suggest: Ask Callback (primary goal)

4. **Name Personalization**
   - Customer mentions their name in transcript
   - Click "Get Next Suggestion"
   - Script should include their actual name

---

## 📈 Success Metrics

**Quality Indicators:**
- ✅ Suggestions match Mark's Golden Scripts (80%+ exact wording)
- ✅ No filler words in output ("uh", "I mean", etc.)
- ✅ Customer name inserted when available
- ✅ Scripts appropriate for conversation stage
- ✅ Every suggestion moves toward callback goal

**User Feedback:**
- Agent feels confident using the scripts
- Scripts sound natural and conversational
- Customer rapport improves
- Higher callback agreement rate

---

## 🔄 Future Enhancements

**Phase 2 Considerations:**
1. Track which scripts lead to successful callbacks
2. A/B test script variations
3. Learn from successful vs unsuccessful calls
4. Optimize script selection based on outcomes

---

Generated: 2026-02-05
Lambda: DevAssistWebSocketStack-IntelligenceHandler
Model: Claude Haiku 4.5 (fast) + Sonnet 4.5 (complex)
