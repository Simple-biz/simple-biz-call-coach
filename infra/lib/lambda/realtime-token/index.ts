/**
 * SBCC v3 live coach (2026-10, ported from call-coach-hsl CCHv2-ST7): mint a single-use Realtime
 * mini session token for the extension.
 *
 * The extension used to need the AI Gateway key itself (fine for a local experiment build,
 * never for the store build). Here the key stays in Secrets Manager (`call-coach/ai-gateway`,
 * value set by hand, never in the CloudFormation template) and only a short-lived client secret
 * leaves AWS — the same split AI Gateway's docs prescribe for browsers.
 *
 * Route `getRealtimeToken` (returnResponse): the body below is sent back on the same socket.
 * Every route is behind $connect's BACKEND_API_KEY check, and the connection's agentId gates the
 * pilot (REALTIME_AGENTS, see shared/realtime-policy.ts).
 *
 * Not in the VPC: it needs internet egress to ai-gateway.vercel.sh and no database.
 * Never logs the key or the token.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection, countRealtimeToken } from '../shared/dynamo-client';
import { getSecretString, getParameterString } from '../shared/secrets-client';
import { isRealtimeAllowed } from '../shared/realtime-policy';

const MODEL = process.env.REALTIME_MODEL || 'openai/gpt-realtime-mini';
const TOKEN_URL = 'https://ai-gateway.vercel.sh/v1/realtime/client-secrets';
const MAX_TOKENS_PER_CONNECTION = 40;
let cachedKey: string | null = null;

// The pilot list lives in SSM (REALTIME_AGENTS_PARAM) so agents can be switched on without a
// deploy: aws ssm put-parameter --name /call-coach/realtime-agents --value 'a@x,b@y' --overwrite
// Cached 60 s per warm Lambda. REALTIME_AGENTS (env) remains as a fallback for local runs.
const AGENTS_TTL_MS = 60_000;
let agentsCache: { value: string; at: number } | null = null;

async function pilotAgents(): Promise<string> {
  const param = process.env.REALTIME_AGENTS_PARAM;
  if (!param) return process.env.REALTIME_AGENTS ?? '';
  if (agentsCache && Date.now() - agentsCache.at < AGENTS_TTL_MS) return agentsCache.value;
  try {
    const value = await getParameterString(param);
    // '-' is the "nobody" placeholder: SSM refuses empty String parameters.
    agentsCache = { value: value.trim() === '-' ? '' : value, at: Date.now() };
  } catch (err) {
    console.error('[RealtimeToken] could not read the pilot list; treating it as empty', err);
    agentsCache = { value: '', at: Date.now() };
  }
  return agentsCache.value;
}

/** The secret holds the bare key, or JSON {"AI_GATEWAY_API_KEY": "..."}. */
export function parseGatewaySecret(secretString: string | undefined): string {
  const raw = (secretString ?? '').trim();
  if (raw.startsWith('{')) {
    try { return String(JSON.parse(raw).AI_GATEWAY_API_KEY ?? '').trim(); } catch { return ''; }
  }
  return raw;
}

async function gatewayKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const key = parseGatewaySecret(await getSecretString(process.env.AI_GATEWAY_SECRET_ARN));
  // CDK creates the secret with a random placeholder; a real gateway key starts with vck_.
  if (key.startsWith('vck_')) cachedKey = key;
  return key;
}

const reply = (body: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 200,
  body: JSON.stringify({ type: 'realtimeToken', ...body }),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const connection = await getConnection(connectionId);
  const agent = connection?.agentId;

  // Capture starts before startConversation registers the agent on this connection; the
  // extension retries on 'no-agent', but treats 'not-enabled' as final.
  if (!agent) return reply({ ok: false, reason: 'no-agent' });

  if (!isRealtimeAllowed(agent, await pilotAgents())) {
    console.log(`[RealtimeToken] refused: agent ${agent ?? '(none)'} is not in the pilot`);
    return reply({ ok: false, reason: 'not-enabled' });
  }

  const key = await gatewayKey();
  if (!key.startsWith('vck_')) {
    console.error('[RealtimeToken] call-coach/ai-gateway holds no gateway key yet');
    return reply({ ok: false, reason: 'not-configured' });
  }

  // Spend guard. The $connect API key ships inside the public extension and the agent id is
  // whatever startConversation claimed, so the pilot list alone can't stop a determined caller
  // from minting sessions on our credits. A real call needs ~7 tokens at most (first + up to 5
  // reconnects + a retry); a 2-hour connection covering several calls stays well under the cap.
  // Backstops: the TokensMinted alarm, and the per-key budget on the AI Gateway side.
  if (!(await countRealtimeToken(connectionId, MAX_TOKENS_PER_CONNECTION))) {
    console.warn(`[RealtimeToken] refused: connection ${connectionId} (${agent}) reached ${MAX_TOKENS_PER_CONNECTION} tokens`);
    return reply({ ok: false, reason: 'limit' });
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, expiresIn: 60 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[RealtimeToken] gateway refused the mint: ${res.status}`);
    return reply({ ok: false, reason: `gateway-${res.status}` });
  }
  const { token, expiresAt } = (await res.json()) as { token: string; expiresAt?: number };
  console.log(`[RealtimeToken] minted for ${agent}`);
  // The session URL comes from here so the extension never names the model.
  const url = `wss://ai-gateway.vercel.sh/v4/ai/realtime-model?ai-model-id=${encodeURIComponent(MODEL)}`;
  return reply({ ok: true, token, url, expiresAt });
};
