# Official Call Script — Source of Truth

**Provided by:** Ron G (sales agent)
**Captured:** May 22, 2026
**Status:** Canonical. The AI suggested lines should track this wording, not improvise.

> This is the actual script + rebuttal set the leadgen team uses in CallTools. The AI coaching prompt
> (`infra/lib/lambda/shared/claude-client-optimized.ts`) should be aligned to it.

---

## Opener

> "My name is _____. Bob Hansen and I are website designers here in Topeka (toe PEEK uh) + Kansas City (KAN zus sit ee). We are very affordable. (or: We build simple, affordable websites that rank really well on Google.) I wanted to see if you'd be interested in talking with someone LOCAL about building or updating your website?"

**If they don't seem to understand:**

> "We are local website designers here in Topeka (toe PEEK uh) + Kansas City (KAN zus sit ee), so we wanted to see if you'd like some help from someone LOCAL on your website."

---

## Rebuttals

**"No, not right now." / "Not at the moment."**
> "I understand. Let me ask you: 'Not right now' because you already have a website? Or is it because you're just busy right now?"

**"We already have a website."**
> "That's great, because we also optimize websites. Would you mind if I have Bob or his partner call you to talk with you about improving the look or ranking of your website?"

**"I am busy right now."**
> "No problem. Since you are busy right now, I will have Bob or his partner call you later today to talk about your website. Would you mind if I have him give you a call?"

**"How much would a simple website cost?"**
> "Great question. We are super affordable. I will get Bob or his partner to reach out today with some general information and pricing. Would you mind if I have either of them give you a call?"

**"I don't have a website."**
> "Well, I'm glad I called, then! I will get Bob or his partner to reach out today to chat with you about building one. Would you mind if I have either of them give you a call?"

**"I don't need a website." / "I'm not interested."**
> "No problem. I do appreciate you taking my call."

**"Have you built any websites for companies in (my industry)/(my city)?"**
> "Absolutely. I will get Bob or his partner to reach out today with some samples of websites we've done in (your area/industry). Would you mind if I have either of them give you a call?"

**"How do I get a hold of you?"**
> "Bob's number is ____. So that we don't play phone tag, let me have him call you. Would you mind if I have him or his partner give you a call?"

**"Where are you guys located?"**
> "Great question. Bob is in Topeka (toe PEEK uh) + Kansas City (KAN zus sit ee). I will get Bob to reach out today with some samples of websites we've done in (your area/industry). Would you mind if I have him or his partner give you a call?"

**"Are you able to do __?"**
> "Great question. I am just Bob's assistant, so I am not sure I'd be giving you the right answer. I will get Bob or his partner to reach out today to give you a quick answer to that question. Would you mind if I have him or his partner give you a call?"

**"Can you send us/email us your information?"**
> "Absolutely. What is your email address? Bob or his partner will want to send over examples of sites they've built for companies like yours, and I am just his assistant, so he'll want to call back and ask you a question or two so he knows what to send. Would they call to talk to YOU about the website, or is there someone else in charge of that?"

---

## Key facts this script establishes

- **Model is callback-based.** Every rebuttal lands on "Would you mind if I have Bob or his partner give you a call?" — not booking an appointment slot directly.
- **Email is NOT a goal.** Email is only requested when the *customer* asks to be emailed — and even then it immediately pivots back to a callback ("Would they call to talk to YOU... or is there someone else in charge?"). The AI currently over-indexes on collecting email; the script does not.
- **Bob's full name is Bob Hansen.**
- **"Bob or his partner"** — there is a real partner (a third person), distinct from the agent. The agent is "Bob's assistant."
- **Locations:** Topeka (toe PEEK uh) + Kansas City (KAN zus sit ee) — phonetic guides matter for delivery.
- **Clarifying move on "not right now":** ask whether it's "already have a website" vs. "just busy" — qualifies before pitching.
