/**
 * SBCC v3 live coach (ported from call-coach-hsl CCHv2-ST9): per-call Realtime mini cost goes to
 * CloudWatch as one structured line from the $default handler — no new route or table. It must
 * not answer the agent with "Unknown message".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetConnection, mockSend } = vi.hoisted(() => ({ mockGetConnection: vi.fn(), mockSend: vi.fn() }))
vi.mock('@infra/lib/lambda/shared/dynamo-client', () => ({ getConnection: (...a: any[]) => mockGetConnection(...a) }))
vi.mock('@infra/lib/lambda/shared/apigw-client', () => ({ sendToConnection: (...a: any[]) => mockSend(...a) }))

import { handler } from '@infra/lib/lambda/default/index'

const ev = (body: object) =>
  ({ requestContext: { connectionId: 'c1', domainName: 'd', stage: 's' }, body: JSON.stringify(body) }) as any

describe('$default: realtimeUsage', () => {
  beforeEach(() => { mockGetConnection.mockReset(); mockSend.mockReset() })

  it('logs one [RealtimeUsage] line with the agent and cost, and sends no error back', async () => {
    mockGetConnection.mockResolvedValue({ connectionId: 'c1', agentId: 'alice@simple.biz' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await handler(ev({ action: 'realtimeUsage', conversationId: 'conv-9', seconds: 612.4, costUsd: 0.07123, model: 'openai/gpt-realtime-mini' }))
    expect(res.statusCode).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.startsWith('[RealtimeUsage] '))!
    expect(JSON.parse(line.slice('[RealtimeUsage] '.length))).toEqual({
      agentId: 'alice@simple.biz', conversationId: 'conv-9', model: 'openai/gpt-realtime-mini', seconds: 612.4, costUsd: 0.07123,
    })
    log.mockRestore()
  })

  it('still answers unknown actions with an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await handler(ev({ action: 'nope' }))
    expect(res.statusCode).toBe(400)
    expect(mockSend).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
