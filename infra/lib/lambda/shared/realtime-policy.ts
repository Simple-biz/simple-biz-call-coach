/**
 * SBCC v3 live coach (2026-10, ported from call-coach-hsl): who may start a Realtime mini session.
 *
 * REALTIME_AGENTS (Lambda env, set at deploy):
 *   ''            nobody (the default: nothing reaches OpenAI until named agents are switched on;
 *                 call audio goes to OpenAI via the AI Gateway once they are)
 *   '*'           every agent
 *   'a@x,b@y'     these agents only (case-insensitive, whitespace ignored)
 *
 * A connection with no agent id (startConversation not sent yet) is never allowed.
 */
export function isRealtimeAllowed(agentId: string | undefined, allowList: string | undefined): boolean {
  if (!agentId) return false;
  const list = (allowList ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.includes('*')) return true;
  return list.includes(agentId.trim().toLowerCase());
}
