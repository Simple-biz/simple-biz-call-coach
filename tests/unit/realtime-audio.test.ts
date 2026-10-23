/**
 * Live coach audio helpers and per-response cost. Adapted from call-coach-hsl's
 * tests/unit/gpt-live-coach.test.ts (the GPT-Live sandbox and buildInstructions cases are not
 * ported: SBCC has no sandbox, and its instructions are covered by live-coach-instructions.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { Upsample16to24, toBase64 } from '@/services/realtime-audio'
import { costOfUsage, contextNote, replayText } from '@/services/realtime-coach'

function fromBase64(b64: string): Int16Array {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new Int16Array(bytes.buffer)
}

describe('Upsample16to24', () => {
  it('turns 16 kHz into 1.5x the samples, across chunk boundaries', () => {
    const up = new Upsample16to24()
    let out = 0
    // 10 chunks of 1,600 samples = 1 s at 16 kHz → ~24,000 samples
    for (let c = 0; c < 10; c++) out += up.convert(new Int16Array(1600)).length
    expect(Math.abs(out - 24000)).toBeLessThanOrEqual(2)
  })

  it('interpolates without jumps at a chunk boundary', () => {
    const up = new Upsample16to24()
    // A straight ramp split in two chunks must come out monotonic.
    const ramp = Int16Array.from({ length: 200 }, (_, i) => i * 100)
    const a = up.convert(ramp.subarray(0, 100))
    const b = up.convert(ramp.subarray(100))
    const all = [...a, ...b].slice(1) // first sample interpolates from the initial 0
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThanOrEqual(all[i - 1])
    expect(all[all.length - 1]).toBeLessThanOrEqual(19900)
  })

  it('keeps silence silent', () => {
    expect(new Upsample16to24().convert(new Int16Array(320)).every((s) => s === 0)).toBe(true)
  })

  it('returns nothing for an empty chunk mid-stream', () => {
    const up = new Upsample16to24()
    up.convert(new Int16Array(1600))
    expect(up.convert(new Int16Array(0)).length).toBe(0)
  })
})

describe('toBase64', () => {
  it('round-trips little-endian Int16 PCM, including negatives', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234])
    expect(Array.from(fromBase64(toBase64(pcm)))).toEqual(Array.from(pcm))
  })

  it('encodes only the view of a subarray, not the whole buffer', () => {
    const whole = Int16Array.from([9, 9, 7, 8, 9, 9])
    expect(Array.from(fromBase64(toBase64(whole.subarray(2, 4))))).toEqual([7, 8])
  })

  it('handles a chunk larger than one 32 KB encoding block', () => {
    const pcm = Int16Array.from({ length: 40000 }, (_, i) => (i % 2000) - 1000)
    expect(Array.from(fromBase64(toBase64(pcm)))).toEqual(Array.from(pcm))
  })

  it('encodes an empty chunk as an empty string', () => {
    expect(toBase64(new Int16Array(0))).toBe('')
  })
})

describe('Realtime mini costOfUsage', () => {
  it('prices a real response (usage captured 2026-10-02)', () => {
    const usage = {
      total_tokens: 113, input_tokens: 87, output_tokens: 26,
      input_token_details: { text_tokens: 33, audio_tokens: 54, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } },
      output_token_details: { text_tokens: 26, audio_tokens: 0 },
    }
    // 54 × $10/M + 33 × $0.60/M + 26 × $2.40/M
    expect(costOfUsage(usage)).toBeCloseTo(0.0006222, 7)
  })

  it('bills cached tokens at the cached rates, not twice', () => {
    const usage = {
      output_tokens: 0,
      input_token_details: { text_tokens: 1000, audio_tokens: 1000, cached_tokens_details: { text_tokens: 1000, audio_tokens: 1000 } },
    }
    // all cached: 1000 × $0.30/M audio + 1000 × $0.06/M text
    expect(costOfUsage(usage)).toBeCloseTo(0.00036, 8)
  })

  it('treats missing usage as free rather than crashing', () => {
    expect(costOfUsage(undefined)).toBe(0)
  })
})

describe('LiveCoach session lifecycle helpers', () => {
  it('labels a context note so the model does not answer it as the lead', () => {
    const note = contextNote('The agent just said: "Do you have a website right now?"')
    expect(note).toMatch(/^\(Context note, not the lead speaking\. Do not reply to this note\./)
    expect(note).toContain('Do you have a website right now?')
  })

  it('replays the most recent turns, newest last, within the size limit', () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({
      speaker: (i % 2 ? 'agent' : 'lead') as 'lead' | 'agent',
      text: `turn ${i} ${'x'.repeat(40)}`,
    }))
    const text = replayText(turns, 500)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text.trimEnd().endsWith(`turn 49 ${'x'.repeat(40)}`)).toBe(true) // the latest turn is kept
    expect(text).not.toContain('turn 0 ') // the oldest is dropped
    expect(text).toMatch(/^Lead: /m)
    expect(text).toMatch(/^Agent: /m)
  })

  it('replays nothing for an empty call', () => {
    expect(replayText([])).toBe('')
  })
})
