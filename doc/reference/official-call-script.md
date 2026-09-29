# Official Call Script — Source of Truth

**Captured:** September 29, 2026 (replaces the May 22, 2026 script from Ron G — see git history)
**Status:** Canonical. The AI suggested lines should track this wording, not improvise.

> This is the script + rebuttal set the leadgen team uses in CallTools. The AI coaching prompt
> (`infra/lib/lambda/shared/claude-client-optimized.ts`) is aligned to it. Test changes with
> `infra/scripts/simulate-lead-persona.ts`.

---

## Opener

> "Hi, my name is _____. Bob Hansen and I are local website designers here in {PLACE NAME}. I know you're busy, but we help businesses and contractors lock down Page-1 rankings on Google and ChatGPT—plus fully manage their Google Business Profile—within 90 days, or it's completely free. I wanted to see if it makes sense to connect with someone local about an update?"

**If they don't seem to understand:**

> "We are local website developers that provide complete web design, hosting, and SEO. As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don't pay a dime."

`{PLACE NAME}` / `{locationguide}` are the **agent's discretion** — the coach leaves `[Place]` for the agent and never fills in a city.

---

## Rebuttals

**"No, not right now." / "Not at the moment."**
> "I understand. Let me ask you—'not right now' because you already have a website, or because you're just busy right now?"

**"We already have a website."**
> "That's great. We also help businesses improve and optimize their existing websites. Would you mind if I have Bob or his partner give you a call to talk about improving the look or ranking of your website?"

**"I'm busy right now."**
> "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?"

**"How much would a simple website cost?"**
> "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?"

**"I don't have a website."**
> "Well, I'm glad I called, then! I'll have Bob or his partner give you a call to talk about building one. Would you mind if I have either of them give you a call?"

**"I don't need a website." / "I'm not interested."**
> "No problem. I appreciate you taking my call."

**"Have you built any websites for companies in my industry?"**
> "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built for businesses like yours. Would you mind if I have them give you a call?"

**"Have you built any websites in my city?"**
> "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built in your area. Would you mind if I have them give you a call?"

**"How do I get a hold of you?"**
> "Bob's number is ______. So we don't end up playing phone tag, would you mind if I have Bob or his partner give you a call?"

**"Where are you guys located?"**
> "Great question. Bob is in {locationguide}. Would you mind if I have Bob or his partner give you a call to talk about your website?"

**"Are you able to do [technical question]?"**
> "Great question. I'm just Bob's assistant, so I don't want to give you the wrong answer. Would you mind if I have Bob or his partner give you a call to answer that for you?"

**"Can you send us/email us your information?"**
> "Absolutely. What's the best email address? Bob or his partner can send over some examples of websites they've built for businesses like yours. Since I'm just his assistant, would they be calling to talk to you about the website, or is there someone else in charge of that?"

**[Likely receptionist who agrees to a callback]**
> "Excellent. Bob or his partner will reach out. Would they talk to YOU about the website, or is there someone else in charge of that?"

**[Target mentions a future date — "I won't be ready to do anything until next year..."]**
> "Excellent. I know you won't be ready to do anything until ____, but would it be okay if Bob or his partner reach out to you LATER TODAY to discuss some ideas with you?"

**[Non-engaging lead]**
> "Just to make sure we're on the same page, is this to build a new website, or to update your existing website?"

---

## Guidelines

**Always**
- Use "Bob or his partner" when offering a callback.
- Keep rebuttals short and conversational.
- When appropriate, connect the response back to the website, rankings, or improving their existing website.
- End with a callback question such as: "Would you mind if I have Bob or his partner give you a call?"

**Avoid**
- Asking the client for a specific appointment time or day. (Instead: "I'll have Bob reach out to you. Would you mind if I have him give you a call?")
- Confirming their phone number.
- Ending answers with "Is this something you'd be interested in?" (Instead: "Would you mind if I have Bob give you a call?")
- Suggesting that Bob send an email with info. It's okay if a client asks for an email, but never suggest it.

## Appointment qualifiers

- Lead shows interest and engages (asks questions)
- Spoke directly with a Decision Maker
- Purpose of the callback is clear (build or update website)
- Lead agrees to a same-day call (today), or next business day if the client requests
- Ask for and confirm the Lead's name

## Enforced in code

- `mentionsPrice()` in `claude-client-optimized.ts` replaces any suggestion containing a price figure with the pricing redirect (the model occasionally caves when a lead pushes hard for a ballpark). Covered by `tests/unit/price-guard.test.ts`.
