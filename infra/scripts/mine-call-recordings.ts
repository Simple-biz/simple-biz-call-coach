/**
 * Mine real Simple Biz calls for the coach: pick a sample from CallTools (west-3), download the
 * recordings, transcribe them (Deepgram, diarized), have Claude review each call against the
 * official script (doc/reference/official-call-script.md), then write a ranked report.
 *
 * Every stage saves to disk and skips work already done, so a crash or a re-run resumes:
 *   sample_recordings/<run>/manifest.json      the chosen calls (no phone numbers)
 *   sample_recordings/<run>/audio/<id>.wav     recordings (real lead audio: gitignored, local only)
 *   sample_recordings/<run>/transcripts/<id>.json
 *   sample_recordings/<run>/reviews/<id>.json
 *   sample_recordings/<run>/report.md
 *
 * Usage (from infra/):
 *   CALLTOOLS_API_KEY=... DEEPGRAM_API_KEY=... npx --yes tsx scripts/mine-call-recordings.ts \
 *     --run 2026-10-w3 --after 2026-10-16 --before 2026-10-22 [--stage all|select|download|transcribe|review|report]
 *   Booked calls from chosen agents only (e.g. the month's best bookers), skipping calls another run has:
 *     ... --run 2026-10-top-agents --agents <id,id,...> --per-agent 30 --exclude-run 2026-10-w3
 * The Anthropic key is read from Secrets Manager `call-coach/api-keys`, as the simulator does.
 */
import './sim-env';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { getSecret } from '../lib/lambda/shared/secrets-client';

const argv = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const RUN = opt('run', 'run')!;
const AFTER = opt('after')!;
const BEFORE = opt('before')!;
const STAGE = opt('stage', 'all')!;
const MIN_TALK = Number(opt('min-talk', '60'));
const MODEL = 'claude-opus-5-5';
const AGENTS = opt('agents')?.split(',').filter(Boolean);
const PER_AGENT = Number(opt('per-agent', '30'));
const EXCLUDE_RUN = opt('exclude-run');

// How many calls of each outcome, by CallTools disposition id.
const QUOTA: Array<{ id: number; label: string; n: number }> = [
  { id: 10566, label: 'Appointment Scheduled', n: 300 },
  { id: 10572, label: 'Not Interested', n: 100 },
  { id: 22184, label: 'Receptionist', n: 70 },
  { id: 10567, label: 'Call Back', n: 30 },
];

const CT = 'https://west-3.calltools.io/api';
const CT_KEY = process.env.CALLTOOLS_API_KEY ?? '';
const DG_KEY = process.env.DEEPGRAM_API_KEY ?? '';
const DIR = join(__dirname, '..', '..', 'sample_recordings', RUN);
const AUDIO = join(DIR, 'audio');
const TRANSCRIPTS = join(DIR, 'transcripts');
const REVIEWS = join(DIR, 'reviews');
for (const d of [AUDIO, TRANSCRIPTS, REVIEWS]) mkdirSync(d, { recursive: true });

type Call = { id: number; fsfile: number; agent: string; disposition: string; billsec: number; start: string; campaign: number | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i >= tries) throw e;
      console.warn(`  retry ${i} ${what}: ${e?.message ?? e}`);
      await sleep(2000 * i);
    }
  }
}

async function ct(path: string): Promise<any> {
  return withRetry(path, async () => {
    const res = await fetch(`${CT}${path}`, { headers: { Authorization: `Token ${CT_KEY}` } });
    if (!res.ok) throw new Error(`CallTools ${res.status}`);
    return res.json();
  });
}

/** Run fn over items, `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

// Seeded shuffle so the same --run picks the same calls.
function shuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
async function select(): Promise<Call[]> {
  const file = join(DIR, 'manifest.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const chosen: Call[] = [];
  const excluded = new Set<number>(
    EXCLUDE_RUN ? JSON.parse(readFileSync(join(DIR, '..', EXCLUDE_RUN, 'manifest.json'), 'utf8')).map((c: Call) => c.id) : [],
  );
  // With --agents: only their booked calls, PER_AGENT each.
  const quota = AGENTS ? [{ ...QUOTA[0], n: PER_AGENT * AGENTS.length }] : QUOTA;
  for (const q of quota) {
    const found: Call[] = [];
    for (let page = 1; ; page++) {
      const d = await ct(`/calls/?page=${page}&page_size=1000&start__date__range_after=${AFTER}&start__date__range_before=${BEFORE}&billsec__range_min=${MIN_TALK}&call_disposition_id=${q.id}`);
      for (const c of d.results) {
        if (c.call_recording_fsfile_id && !excluded.has(c.id) && (!AGENTS || AGENTS.includes(c.app_user))) {
          found.push({ id: c.id, fsfile: c.call_recording_fsfile_id, agent: c.app_user, disposition: q.label, billsec: c.billsec, start: c.start, campaign: c.campaign });
        }
      }
      if (!d.next) break;
    }
    // Spread across agents: round-robin over each agent's shuffled calls.
    const byAgent = new Map<string, Call[]>();
    for (const c of shuffle(found, q.id)) byAgent.set(c.agent, [...(byAgent.get(c.agent) ?? []), c]);
    if (AGENTS) for (const [agent, list] of byAgent) byAgent.set(agent, list.slice(0, PER_AGENT));
    const picked: Call[] = [];
    while (picked.length < q.n && [...byAgent.values()].some((l) => l.length)) {
      for (const list of byAgent.values()) if (list.length && picked.length < q.n) picked.push(list.shift()!);
    }
    console.log(`${q.label}: ${found.length} with recordings, picked ${picked.length} from ${byAgent.size} agents`);
    chosen.push(...picked);
  }
  writeFileSync(file, JSON.stringify(chosen, null, 1));
  return chosen;
}

async function download(calls: Call[]) {
  let done = 0;
  await pool(calls, 6, async (c) => {
    const file = join(AUDIO, `${c.id}.wav`);
    if (existsSync(file)) return void done++;
    await withRetry(`download ${c.id}`, async () => {
      const res = await fetch(`${CT}/filesystemfiles/${c.fsfile}/download/`, { headers: { Authorization: `Token ${CT_KEY}` } });
      if (!res.ok) throw new Error(`download ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    });
    if (++done % 25 === 0) console.log(`  downloaded ${done}/${calls.length}`);
  });
  console.log(`downloaded ${done}/${calls.length}`);
}

async function transcribe(calls: Call[]) {
  let done = 0;
  await pool(calls, 6, async (c) => {
    const out = join(TRANSCRIPTS, `${c.id}.json`);
    const wav = join(AUDIO, `${c.id}.wav`);
    if (existsSync(out) || !existsSync(wav)) return void done++;
    const d = await withRetry(`transcribe ${c.id}`, async () => {
      const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&smart_format=true&utterances=true', {
        method: 'POST',
        headers: { Authorization: `Token ${DG_KEY}`, 'Content-Type': 'audio/wav' },
        body: readFileSync(wav),
      });
      if (!res.ok) throw new Error(`deepgram ${res.status}`);
      return res.json() as Promise<any>;
    });
    const utterances = (d.results?.utterances ?? []).map((u: any) => ({ speaker: u.speaker, start: u.start, text: u.transcript }));
    writeFileSync(out, JSON.stringify({ id: c.id, seconds: d.metadata?.duration, utterances }, null, 1));
    if (++done % 25 === 0) console.log(`  transcribed ${done}/${calls.length}`);
  });
  console.log(`transcribed ${done}/${calls.length}`);
}

// ---------------------------------------------------------------------------------------------
const SITUATIONS = [
  'not_right_now', 'already_have_website', 'busy', 'price', 'no_website', 'not_interested', 'built_in_industry', 'built_in_city',
  'how_to_reach', 'location', 'technical_question', 'email_request', 'receptionist', 'future_date', 'non_engaging', 'doesnt_understand',
  // Not answered by the script: the gaps the coach needs real lines for.
  'how_did_you_get_my_number', 'company_name', 'is_this_a_robot', 'whats_the_catch', 'is_this_a_scam', 'other',
] as const;

const ReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agent_speaker', 'outcome', 'opener_followed', 'script_adherence', 'qualifiers', 'moments', 'strengths', 'issues', 'overall', 'summary'],
  properties: {
    agent_speaker: { type: 'integer', description: 'Diarized speaker number of the sales agent (Bob\'s assistant).' },
    outcome: { type: 'string', enum: ['appointment_booked', 'callback_unconfirmed', 'email_only', 'declined', 'gatekeeper_no_dm', 'voicemail_or_dead', 'other'] },
    opener_followed: { type: 'boolean', description: 'The agent delivered the script\'s opener (name, Bob Hansen, local website designers, Page-1 / 90 days or free).' },
    script_adherence: { type: 'integer', description: '0-10: how closely the agent used the script\'s rebuttals and followed its guidelines.' },
    qualifiers: {
      type: 'object', additionalProperties: false,
      required: ['lead_engaged', 'decision_maker', 'purpose_clear', 'same_day_or_next', 'name_confirmed'],
      properties: {
        lead_engaged: { type: 'boolean' }, decision_maker: { type: 'boolean' }, purpose_clear: { type: 'boolean' },
        same_day_or_next: { type: 'boolean' }, name_confirmed: { type: 'boolean' },
      },
    },
    moments: {
      type: 'array', description: 'Each objection or question the lead raised, and how the agent handled it.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['situation', 'lead_said', 'agent_said', 'used_script_line', 'worked'],
        properties: {
          situation: { type: 'string', enum: [...SITUATIONS] },
          lead_said: { type: 'string', description: 'Short quote.' },
          agent_said: { type: 'string', description: 'The agent\'s reply, quoted from the transcript.' },
          used_script_line: { type: 'boolean' },
          worked: { type: 'boolean', description: 'The lead moved toward the callback or stayed engaged after this reply.' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' }, description: 'Script guideline breaks: price quoted, time/day asked, phone confirmed, email suggested, "interested?" ending, missing "Bob or his partner", invented facts.' },
    overall: { type: 'integer', description: '0-10: how good this call is as a model call for training agents and the coach.' },
    summary: { type: 'string', description: 'Two sentences.' },
  },
} as const;

const SCRIPT = readFileSync(join(__dirname, '..', '..', 'doc', 'reference', 'official-call-script.md'), 'utf8');
const SYSTEM = `You review recorded cold calls from Simple Biz's lead generation team against their official call script.
The agent is "Bob's assistant" and books a callback from "Bob or his partner" (Bob Hansen, local website designer). The lead is a small business.
The transcript is machine-diarized from a single mono recording: speaker numbers may be swapped and words may be misheard; judge from content.
Quote the agent's actual words when you record what they said. Be strict about the script's guidelines and appointment qualifiers.

OFFICIAL SCRIPT:
${SCRIPT}`;

async function review(calls: Call[]) {
  const client = new Anthropic({ apiKey: await getSecret('ANTHROPIC_API_KEY') });
  let done = 0, failed = 0;
  await pool(calls, 6, async (c) => {
    const out = join(REVIEWS, `${c.id}.json`);
    const tf = join(TRANSCRIPTS, `${c.id}.json`);
    if (existsSync(out) || !existsSync(tf)) return void done++;
    const t = JSON.parse(readFileSync(tf, 'utf8'));
    if (!t.utterances?.length) return void done++;
    const transcript = t.utterances.map((u: any) => `S${u.speaker}: ${u.text}`).join('\n');
    try {
      const res = await withRetry(`review ${c.id}`, () => client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: jsonSchemaOutputFormat(ReviewSchema) },
        messages: [{ role: 'user', content: `CallTools disposition: ${c.disposition}. Talk time: ${c.billsec}s.\n\nTRANSCRIPT:\n${transcript}` }],
      } as any), 3);
      if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`no review (${res.stop_reason})`);
      writeFileSync(out, JSON.stringify({ call: c, review: res.parsed_output, usage: res.usage }, null, 1));
    } catch (e: any) {
      failed++;
      console.warn(`  review ${c.id} failed: ${e?.message ?? e}`);
    }
    if (++done % 25 === 0) console.log(`  reviewed ${done}/${calls.length}`);
  });
  console.log(`reviewed ${done}/${calls.length} (${failed} failed)`);
}

// ---------------------------------------------------------------------------------------------
function report() {
  // Lead gen only (Kayser, 2026-10-23): west-3 also carries billing, other campaigns and other
  // businesses' calls, all in the no-campaign (inbound/manual) bucket. Campaign calls are lead gen;
  // a no-campaign call counts only when the review found the Bob's-assistant script in it.
  const all = readdirSync(REVIEWS).map((f) => JSON.parse(readFileSync(join(REVIEWS, f), 'utf8')));
  const isLeadGen = (r: any) => r.call.campaign != null || r.review.script_adherence >= 2;
  const rows = all.filter(isLeadGen);
  const q = (r: any) => Object.values(r.review.qualifiers).filter(Boolean).length;
  const booked = rows.filter((r) => r.call.disposition === 'Appointment Scheduled');
  const best = [...booked].sort((a, b) => b.review.overall - a.review.overall || q(b) - q(a) || b.review.script_adherence - a.review.script_adherence);

  // Per agent: how many sampled calls, booked share, average quality.
  const agents = new Map<string, any[]>();
  for (const r of rows) agents.set(r.call.agent, [...(agents.get(r.call.agent) ?? []), r]);
  const agentRows = [...agents.entries()].map(([agent, rs]) => {
    const b = rs.filter((r) => r.call.disposition === 'Appointment Scheduled');
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    return { agent, calls: rs.length, booked: b.length, quality: avg(b.map((r) => r.review.overall)), adherence: avg(rs.map((r) => r.review.script_adherence)), fullQualified: b.filter((r) => q(r) === 5).length };
  }).filter((a) => a.booked >= 2).sort((x, y) => y.quality - x.quality);

  // Real answers that worked, by situation (the gaps first).
  const moments = rows.flatMap((r) => r.review.moments.map((m: any) => ({ ...m, call: r.call.id, overall: r.review.overall })));
  const bySituation = new Map<string, any[]>();
  for (const m of moments) bySituation.set(m.situation, [...(bySituation.get(m.situation) ?? []), m]);

  const usage = rows.reduce((s, r) => ({ i: s.i + (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0), o: s.o + (r.usage?.output_tokens ?? 0) }), { i: 0, o: 0 });
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
  const lines: string[] = [
    `# Call mining report: ${RUN} (${AFTER} to ${BEFORE})`, '',
    `${rows.length} lead gen calls reviewed by ${MODEL} against the official script (talk >= ${MIN_TALK}s); ${all.length - rows.length} other-team calls left out. Booked: ${booked.length}.`,
    `Review tokens: ${usage.i.toLocaleString()} in, ${usage.o.toLocaleString()} out.`, '',
    '## Qualifiers on booked calls', '',
    '| Qualifier | Met |', '|---|---|',
    ...['lead_engaged', 'decision_maker', 'purpose_clear', 'same_day_or_next', 'name_confirmed'].map((k) => `| ${k} | ${pct(booked.filter((r) => r.review.qualifiers[k]).length, booked.length)} |`),
    `| all five | ${pct(booked.filter((r) => q(r) === 5).length, booked.length)} |`,
    `| opener followed (all calls) | ${pct(rows.filter((r) => r.review.opener_followed).length, rows.length)} |`, '',
    '## Agents (2+ booked calls in the sample), by quality of their booked calls', '',
    '| Agent | Sampled | Booked | All 5 qualifiers | Avg quality (0-10) | Avg script adherence |', '|---|---|---|---|---|---|',
    ...agentRows.map((a) => `| ${a.agent.slice(0, 8)} | ${a.calls} | ${a.booked} | ${a.fullQualified} | ${a.quality.toFixed(1)} | ${a.adherence.toFixed(1)} |`), '',
    '## Top 20 booked calls', '',
    '| Call | Agent | Talk | Quality | Adherence | Qualifiers | Summary |', '|---|---|---|---|---|---|---|',
    ...best.slice(0, 20).map((r) => `| ${r.call.id} | ${r.call.agent.slice(0, 8)} | ${r.call.billsec}s | ${r.review.overall} | ${r.review.script_adherence} | ${q(r)}/5 | ${r.review.summary.replace(/\|/g, '/')} |`), '',
    '## What agents actually said, by situation (replies that worked, from the best calls first)', '',
  ];
  const order = [...SITUATIONS].sort((a, b) => Number(SITUATIONS.indexOf(b) >= 16) - Number(SITUATIONS.indexOf(a) >= 16));
  for (const s of order) {
    const ms = bySituation.get(s) ?? [];
    if (!ms.length) continue;
    const worked = ms.filter((m) => m.worked).sort((a, b) => b.overall - a.overall);
    lines.push(`### ${s} (${ms.length} times, worked ${pct(worked.length, ms.length)}, script line used ${pct(ms.filter((m) => m.used_script_line).length, ms.length)})`, '');
    for (const m of worked.slice(0, 5)) lines.push(`- Lead: "${m.lead_said}" → Agent: "${m.agent_said}" (call ${m.call})`);
    lines.push('');
  }
  const issues = new Map<string, number>();
  for (const r of rows) for (const i of r.review.issues) issues.set(i.toLowerCase().slice(0, 80), (issues.get(i.toLowerCase().slice(0, 80)) ?? 0) + 1);
  lines.push('## Most common guideline issues', '', ...[...issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([i, n]) => `- ${n}× ${i}`));
  writeFileSync(join(DIR, 'report.md'), lines.join('\n'));
  console.log(`report: ${join(DIR, 'report.md')}`);
}

async function main() {
  if (!AFTER || !BEFORE) throw new Error('--after and --before are required (YYYY-MM-DD)');
  const calls = await select();
  if (STAGE === 'select') return;
  if (STAGE === 'all' || STAGE === 'download') { if (!CT_KEY) throw new Error('CALLTOOLS_API_KEY not set'); await download(calls); }
  if (STAGE === 'all' || STAGE === 'transcribe') { if (!DG_KEY) throw new Error('DEEPGRAM_API_KEY not set'); await transcribe(calls); }
  if (STAGE === 'all' || STAGE === 'review') await review(calls);
  if (STAGE === 'all' || STAGE === 'report') report();
}

main().catch((e) => { console.error(e); process.exit(1); });
