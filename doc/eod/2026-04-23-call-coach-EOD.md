# Call Coach Chrome Extension — End of Day Report

**Date:** April 23, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach
**Version:** 2.2.10 → **2.2.11** (hotfix)

---

## Session Overview

**Focus:** Production hotfix — Deepgram transcription broken on every live call.

**Outcome:** 1 PR shipped and merged to `main` (#77). Deepgram API key rotated in GitHub Actions secrets, version bumped to force a CI rebuild with the new key.

---

## Commits Today

| Commit | Message |
|--------|---------|
| `3890218` | hotfix: bump to v2.2.11 to bake rotated Deepgram API key (#77) |

---

## Accomplishments

### ✅ PR #77 — Deepgram API key hotfix (v2.2.11)

**Problem:** Production agents reported Call Coach "not working." Background service worker logs showed calls starting cleanly, audio flowing (steady `AUDIO_LEVEL_UPDATE` stream), and AI Backend connecting — but Deepgram WebSockets for both the caller and agent channels were cycling `error → disconnected` repeatedly throughout every call.

Result: **zero transcripts → zero AI tips → `[History] No final transcripts to save`** on every call.

**Root cause:** Deepgram API key rejected by the Deepgram WebSocket server. Either rotated/expired or the account hit a balance limit. The background log line `🔑 [Background] Deepgram API key found` only confirms a string exists in storage — not that Deepgram accepted it.

**Fix:**
1. Rotated the Deepgram API key and updated the `VITE_DEEPGRAM_API_KEY` secret in GitHub Actions (the CI build source of truth — local `.env.production` isn't used by CI).
2. Bumped version `2.2.10 → 2.2.11` across `package.json`, `vite.config.ts`, and `src/background/index.ts`. Required because:
   - Chrome Web Store rejects duplicate version uploads (`PKG_INVALID_VERSION_NUMBER`).
   - A commit-triggered rebuild is the only way to bake the rotated secret into the extension bundle.

**Files touched (3):** version string only — no behavior changes.

---

## Deployment Notes

- **GitHub Actions secret:** `VITE_DEEPGRAM_API_KEY` updated before merge so the triggered build would pick up the new key.
- **CI/CD:** Deploy workflow (`.github/workflows/deploy.yml`) fires on push to `main`, skips on `.md` / `docs/` paths only — version bump commit triggered a full rebuild + Chrome Web Store upload + publish.
- **PR #77 merged:** 2026-04-23 15:20 UTC.

---

## Agent Update Message

> Call Coach v2.2.11 is live! Reload the extension to get the update.
>
> What's new:
>
> 🔧 Fixed — transcription was failing on every call due to a backend credential issue. Deepgram is reconnected and transcripts + AI tips are flowing again.
>
> To update:
>
> Go to Manage extensions.
> On the upper left click the 'Update' Button.
> Once the popup message on the lower left says 'Extensions Updated' then you're good to go. Happy call-coachin everyone!
