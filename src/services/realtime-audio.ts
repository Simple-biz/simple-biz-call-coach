/**
 * Audio helpers for the live coach. The offscreen worklets produce 16 kHz Int16 PCM (what Deepgram
 * takes); the realtime session wants 24 kHz PCM, base64-encoded. Copied from call-coach-hsl's
 * gpt-live-coach.ts (v3), without its sandbox.
 */

export type LiveCoachStatus = 'off' | 'connecting' | 'live' | 'error'

/** 16 kHz → 24 kHz linear-interpolation resampler, stateful across chunks. */
export class Upsample16to24 {
  private last = 0
  private pos = 0 // position of the next output sample, in input samples, relative to `last`
  convert(input: Int16Array): Int16Array {
    const out: number[] = []
    const step = 16000 / 24000
    // Index -1 is the previous chunk's final sample, so interpolation spans the boundary.
    const at = (i: number) => (i < 0 ? this.last : input[i])
    let t = this.pos - 1
    while (t <= input.length - 1) {
      const i = Math.floor(t)
      const f = t - i
      const a = at(i)
      const b = i + 1 <= input.length - 1 ? at(i + 1) : a
      out.push(Math.round(a + (b - a) * f))
      t += step
    }
    this.pos = t - (input.length - 1)
    if (input.length) this.last = input[input.length - 1]
    return Int16Array.from(out)
  }
}

export function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}
