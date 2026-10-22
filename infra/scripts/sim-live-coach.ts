/**
 * The live coach (v3) as the lead-persona simulator drives it: a realtime session on the AI Gateway
 * (openai/gpt-realtime-mini), configured exactly as src/services/realtime-coach.ts configures it,
 * fed the lead's lines as speech in real time.
 *
 * Approach from call-coach-hsl infra/scripts/engine-compare.ts (runRealtimeMini):
 *   - each lead line is spoken with openai/tts-1 (raw 24 kHz PCM16) through the gateway and streamed
 *     into the session at real-time pace, silence in between (the model hears only the lead);
 *   - a line the model starts while the lead is still speaking is premature: counted, never used;
 *   - cost comes from the usage on every response-done (lib/experiments/realtime-pricing.ts).
 * One change: the audio pump is paced by the clock, not by setInterval ticks (Windows timers tick
 * at ~15.6 ms, so a 20 ms interval sends audio slower than real time).
 *
 * The gateway key is AI_GATEWAY_API_KEY, from the environment or the repo-root .env.local. It is
 * never printed or written anywhere.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { buildInstructions } from '../lib/experiments/live-coach-instructions';
import { costOfUsage } from '../lib/experiments/realtime-pricing';
import { contextNote } from '../../src/services/realtime-coach';

export const LIVE_MODEL = 'openai/gpt-realtime-mini';
export const TTS_MODEL = 'openai/tts-1';
const TTS_USD_PER_CHAR = 15 / 1e6; // tts-1: $15 per 1M characters (simulation overhead, not coach cost)
const RATE = 24000; // samples/s, PCM16 mono
const GATEWAY = 'https://ai-gateway.vercel.sh';

let cachedKey: string | undefined;
export function gatewayKey(): string {
  if (cachedKey) return cachedKey;
  let key = process.env.AI_GATEWAY_API_KEY?.trim();
  const envFile = resolve(__dirname, '../../.env.local');
  if (!key && existsSync(envFile)) {
    for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^\s*(?:export\s+)?AI_GATEWAY_API_KEY\s*=\s*(.*)$/);
      if (m) key = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!key) throw new Error('No AI Gateway key: set AI_GATEWAY_API_KEY or add it to the repo-root .env.local');
  return (cachedKey = key);
}

/** Team-wide gateway spend so far (USD). */
export async function gatewayCredits(): Promise<{ balance: number; totalUsed: number } | null> {
  try {
    const r = await fetch(`${GATEWAY}/v1/credits`, { headers: { Authorization: `Bearer ${gatewayKey()}` } });
    if (!r.ok) return null;
    const j = (await r.json()) as { balance: string; total_used: string };
    return { balance: Number(j.balance), totalUsed: Number(j.total_used) };
  } catch { return null; }
}

/** Speaks a line with openai/tts-1 via the gateway: raw 24 kHz PCM16. */
export async function tts(text: string): Promise<{ pcm: Buffer; costUsd: number }> {
  const res = await fetch(`${GATEWAY}/v4/ai/speech-model`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayKey()}`, 'ai-gateway-protocol-version': '0.0.1',
      'ai-speech-model-specification-version': '4', 'ai-model-id': TTS_MODEL, 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice: 'alloy', outputFormat: 'pcm' }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const pcm = Buffer.from(((await res.json()) as { audio: string }).audio, 'base64');
  return { pcm: trimSilence(pcm), costUsd: text.length * TTS_USD_PER_CHAR };
}

/**
 * tts-1 pads each clip with ~1 s of trailing silence. Left in, the session's VAD (600 ms) ends the
 * turn while the pump is still sending that silence, so a reply to the finished line counted as
 * premature and reply delays were measured from the wrong moment. Trim to 50 ms either side.
 */
function trimSilence(pcm: Buffer, threshold = 300, keepMs = 50): Buffer {
  const n = Math.floor(pcm.length / 2);
  const loud = (i: number) => Math.abs(pcm.readInt16LE(i * 2)) >= threshold;
  let a = 0, b = n - 1;
  while (a < n && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  if (a >= b) return pcm;
  const keep = Math.round((keepMs * RATE) / 1000);
  return pcm.subarray(Math.max(0, a - keep) * 2, Math.min(n, b + 1 + keep) * 2);
}

export type Reply = { text: string; delayMs: number; startedAt: number };

export class LiveSession {
  costUsd = 0;
  responses = 0;
  premature: string[] = []; // lines started while the lead was still speaking (not used)
  late: string[] = []; // lines that arrived after a turn had already been given up as no-reply
  errors: string[] = [];
  leadHeard: string[] = []; // the session's own transcription of the lead (input-transcription-completed)
  openedAt = 0;

  private ws: any;
  private queue = Buffer.alloc(0);
  private speaking = false;
  private speechEndAt = 0;
  private line = '';
  private lineStartedAt = 0;
  private lineStartedEarly = false;
  private finished: Reply[] = [];
  private pump: NodeJS.Timeout | null = null;
  private sentSamples = 0;
  private pumpT0 = 0;
  private closed = false;
  private droppedAt = 0; // a line was cut off; the rest of that response is ignored

  static async open(instructions = buildInstructions()): Promise<LiveSession> {
    const s = new LiveSession();
    const tok = await fetch(`${GATEWAY}/v1/realtime/client-secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gatewayKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LIVE_MODEL }),
    });
    if (!tok.ok) throw new Error(`token ${tok.status}: ${(await tok.text()).slice(0, 200)}`);
    const { token } = (await tok.json()) as { token: string };
    const WS = (globalThis as any).WebSocket;
    if (!WS) throw new Error('No global WebSocket (needs Node 22+)');
    s.ws = new WS(`wss://ai-gateway.vercel.sh/v4/ai/realtime-model?ai-model-id=${encodeURIComponent(LIVE_MODEL)}`, ['ai-gateway-realtime.v1', `ai-gateway-auth.${token}`]);
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('live session did not open in 15s')), 15000);
      s.ws.onopen = () => {
        // Same first frame as src/services/realtime-coach.ts.
        s.send({
          type: 'session-update',
          config: {
            instructions,
            outputModalities: ['text'],
            inputAudioFormat: { type: 'audio/pcm', rate: RATE },
            inputAudioTranscription: {},
            turnDetection: { type: 'server-vad', silenceDurationMs: 600 },
          },
        });
        clearTimeout(t);
        s.openedAt = Date.now();
        res();
      };
      s.ws.onerror = () => { clearTimeout(t); rej(new Error('socket error')); };
    });
    s.ws.onmessage = async (m: { data: any }) => {
      try {
        const text = typeof m.data === 'string' ? m.data : Buffer.from(await m.data.arrayBuffer?.() ?? m.data).toString('utf8');
        s.onEvent(JSON.parse(text));
      } catch { s.errors.push('unreadable frame'); }
    };
    s.ws.onclose = (e: any) => { if (!s.closed) s.errors.push(`socket closed ${e?.code ?? ''}`); s.closed = true; };
    s.startPump();
    return s;
  }

  get isClosed() { return this.closed; }

  private send(e: object) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(e)); }

  private onEvent(ev: any) {
    switch (ev?.type) {
      case 'text-delta':
        if (this.dropping()) break;
        if (!this.line) { this.lineStartedEarly = this.speaking; this.lineStartedAt = Date.now(); }
        this.line += ev.delta || '';
        break;
      case 'text-done':
        if (this.dropping()) break;
        if (!this.line && ev.text) { this.line = ev.text; this.lineStartedAt ||= Date.now(); this.lineStartedEarly = this.speaking; }
        this.endLine();
        break;
      case 'speech-started':
        // As in realtime-coach.ts: the lead talking again drops a half-written line.
        if (this.line.trim()) { this.premature.push(`${this.line.trim()} [cut off]`); this.line = ''; this.droppedAt = Date.now(); }
        break;
      case 'input-transcription-completed':
        if (ev.transcript) this.leadHeard.push(String(ev.transcript).trim());
        break;
      case 'response-done':
        this.responses++;
        this.costUsd += costOfUsage(ev.raw?.response?.usage || ev.raw?.usage);
        if (this.dropping()) { this.droppedAt = 0; this.line = ''; break; }
        if (this.line) this.endLine(); // a cancelled response ends without text-done
        break;
      case 'error':
        this.errors.push(String(ev.error?.message || ev.message || JSON.stringify(ev).slice(0, 160)));
        break;
    }
  }

  private dropping() { return this.droppedAt > 0 && Date.now() - this.droppedAt < 3000; }

  private endLine() {
    const text = this.line.trim();
    this.line = '';
    if (!text) return;
    if (this.lineStartedEarly) { this.premature.push(text); return; }
    this.finished.push({ text, startedAt: this.lineStartedAt, delayMs: 0 });
  }

  // Real-time pump, paced by the clock: speech while queued, silence otherwise.
  private startPump() {
    this.pumpT0 = Date.now();
    this.sentSamples = 0;
    this.pump = setInterval(() => {
      const due = Math.floor(((Date.now() - this.pumpT0) * RATE) / 1000);
      let need = due - this.sentSamples;
      if (need < 480) return; // send in >= 20 ms chunks
      if (need > RATE) { this.sentSamples = due - RATE; need = RATE; } // after a stall, at most 1 s at once
      const bytes = need * 2;
      const frame = Buffer.alloc(bytes);
      if (this.queue.length) {
        const n = Math.min(bytes, this.queue.length);
        this.queue.copy(frame, 0, 0, n);
        this.queue = this.queue.subarray(n);
        if (!this.queue.length && this.speaking) { this.speaking = false; this.speechEndAt = Date.now(); }
      }
      this.sentSamples += need;
      this.send({ type: 'input-audio-append', audio: frame.toString('base64') });
    }, 10);
  }

  /** Streams one lead line at real-time pace; resolves when the last sample has gone out. */
  async speak(pcm: Buffer): Promise<void> {
    if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
    this.speaking = true;
    this.queue = Buffer.concat([this.queue, pcm]);
    while (this.speaking && !this.closed) await sleep(10);
    if (this.closed) this.speechEndAt = Date.now();
  }

  /**
   * The coach line for the turn just spoken: the LAST line that started after the lead stopped
   * (what the agent sees last on screen), once nothing else is streaming. null if none in time.
   */
  async awaitReply(timeoutMs = 15000, graceMs = 400): Promise<Reply | null> {
    const end = this.speechEndAt;
    const fresh = () => this.finished.filter(f => f.startedAt >= end);
    const waitStart = Date.now();
    let settledAt = 0;
    while (Date.now() - waitStart < timeoutMs && !this.closed) {
      if (fresh().length && !this.line) {
        settledAt ||= Date.now();
        if (Date.now() - settledAt >= graceMs) break;
      } else settledAt = 0;
      await sleep(25);
    }
    const lines = fresh();
    // Anything finished that is not this turn's reply is a late answer to an earlier turn.
    for (const f of this.finished) if (f.startedAt < end) this.late.push(f.text);
    this.finished = [];
    if (!lines.length) return null;
    const last = lines[lines.length - 1];
    return { text: last.text, startedAt: last.startedAt, delayMs: lines[0].startedAt - end };
  }

  /** What the agent said, as realtime-coach.ts noteAgent() sends it. */
  noteAgent(text: string) {
    const t = text.trim();
    if (!t) return;
    this.send({ type: 'conversation-item-create', item: { type: 'text-message', role: 'user', text: contextNote(`The agent just said: "${t}"`) } });
  }

  async close(): Promise<void> {
    if (this.pump) clearInterval(this.pump);
    await sleep(1500); // let the last response-done (usage) arrive
    this.closed = true;
    try { this.ws?.close(); } catch { /* already closed */ }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
