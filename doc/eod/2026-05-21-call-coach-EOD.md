# Call Coach Chrome Extension — End of Day Report

**Date:** May 21, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach
**Version:** 2.2.12 → **2.2.13**

---

## Session Overview

**Focus:** Bug fix — Deepgram produced zero transcripts for one specific agent (Gray) despite a healthy WebSocket connection and confirmed audio flow.

**Outcome:** Root-cause fix in the AudioWorklet downsampler. Verified working for the affected agent. Version bumped to 2.2.13.

---

## Accomplishments

### ✅ AudioWorklet sample-rate fix (v2.2.13)

**Problem:** For one agent (Gray), Call Coach connected to Deepgram successfully and the audio monitor showed clear levels (jumping to ~50% when the agent spoke), but **no transcripts were ever produced**. Every other agent transcribed normally. The same mic transcribed fine on dictation.io, ruling out the microphone, OS audio settings, and any virtual audio drivers.

**Root cause:** The AudioWorklet downsampler in `src/offscreen/audio-worklet-processor.js` assumed a native sample rate of 48000 Hz:

```js
this.nativeSampleRate = options.processorOptions?.sampleRate || 48000;
```

The bridge in `src/offscreen/index.ts` **never passes `sampleRate`** in `processorOptions`, so this always fell back to 48000. On Gray's machine (Realtek audio defaulting to **44100 Hz**), the AudioContext actually ran at 44.1 kHz. The downsample ratio was computed as `Math.round(48000 / 16000) = 3`, producing output at `44100 / 3 = 14700 Hz` while labeling it as 16000 Hz to Deepgram — an **8.8% pitch/speed shift** that rendered the audio unintelligible to the speech model. Deepgram received valid audio and stayed connected, but couldn't recognize any words.

**Fix (`src/offscreen/audio-worklet-processor.js`):**

1. **Read the AudioContext's actual sample rate** — use the `sampleRate` global available in `AudioWorkletGlobalScope` instead of a value that was never passed. The worklet now knows whether it's running at 44100, 48000, or any other rate.

2. **Fractional downsampling with linear interpolation** — replaced naive decimation (`channelData[i * ratio]`, which only works for integer ratios) with linear interpolation, so fractional ratios like `44100 / 16000 = 2.75625` produce correctly-timed samples instead of running fast.

**Regression safety:** For agents already on 48 kHz the ratio is exactly 3.0 and the interpolation degenerates to picking the same samples as before — behavior is unchanged. Only mismatched-rate machines (like Gray's 44.1 kHz) are corrected.

**Verification:** Gray made a test call on the new build and transcripts now appear correctly. The new diagnostic log line (`[AudioWorklet] Initialized for agent: <rate>Hz → 16000Hz (ratio=...)`) confirms the true device sample rate on each call.

**Files touched:** `src/offscreen/audio-worklet-processor.js` (fix) + version bump in `package.json`, `vite.config.ts`, `src/background/index.ts`. Also ignored local `*.rar`/`*.zip` archives in `.gitignore`.

---

## Deployment Notes

- **CI/CD:** Deploy workflow fires on push to `main` — the version bump in the squash commit triggers a full rebuild + Chrome Web Store upload + publish.

---

## Agent Update Message

> Call Coach v2.2.13 is live! Reload the extension to get the update.
>
> What's new:
>
> 🔧 Fixed — For a small number of agents, the live call was connecting but no transcription was appearing. This was caused by a mismatch in how the audio was processed on certain audio devices. Transcription now works correctly regardless of your sound hardware.
>
> To update:
>
> Go to Manage extensions.
> On the upper left click the 'Update' Button.
> Once the popup message on the lower left says 'Extensions Updated' then you're good to go. Happy call-coachin everyone!
