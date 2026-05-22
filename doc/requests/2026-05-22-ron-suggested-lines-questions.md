# Questions for Ron — AI Suggested Lines Feedback

**Date:** May 22, 2026
**For:** Ron G (sales agent)
**From:** Kayser B
**Re:** Refining the AI suggested lines toward setting qualified appointments

---

## Context

Ron's feedback:

> "I'm mainly concerned about the AI-suggested lines. Since gathering email addresses from the receptionist won't result in a valid appointment, it would be helpful if the suggestions didn't focus on that. The suggested lines should instead centralize on the call scripts and rebuttals we use in Call Tools. It's great to have out-of-the-box suggested lines, it would be better if they focused on setting qualified appointments."

The current coaching engine is built around a **callback model** (goal = get the owner to agree to a callback from Bob, then collect name/business/email/time). Before we change the live prompt, we need to confirm the intended workflow and pull in Ron's real scripts.

---

## Questions

1. **The end goal** — When a call goes well, what's the actual finish line we want the agent to hit? Booking a set appointment time on the call, or getting the prospect to agree to a callback from Bob? (Right now the AI is built around the callback + email model — want to confirm that's still what we're selling.)

2. **The email issue** — Is the problem that the AI asks for email *at all*, or specifically that it asks **receptionists / gatekeepers** for email? Want to make sure we kill the right behavior and don't break legit cases where email is fine.

3. **"Qualified appointment"** — In your words, what makes an appointment *qualified*? (e.g. confirmed decision-maker / owner, genuine interest expressed, specific time agreed?) We'll use that as the gate before the AI starts collecting anything.

4. **Scripts & rebuttals** — You mentioned the suggestions should center on the scripts / rebuttals you use in CallTools. Can you point us to where those live (a doc, the CallTools script tab, a shared sheet)? If we can see the exact wording your team uses, we can make the AI suggest *those* lines instead of its own.

5. **A real example** — If you've got one recent call where the suggested line was off, what did it suggest vs. what you'd have wanted it to say? One concrete example is worth more than a dozen guesses.

---

## Why these matter

- **#1 + #4** decide the scope: a narrow gatekeeper/qualification fix vs. a fuller reframe toward appointment-setting — and #4 lets us feed Ron's real scripts into the suggestion library instead of the AI improvising.
- **#2** scopes the email change precisely (all contacts vs. gatekeepers only).
- **#3** gives us the qualification gate so the AI only pushes to collect details from real, interested decision-makers.
- **#5** grounds the change in an actual failure case we can test against.
