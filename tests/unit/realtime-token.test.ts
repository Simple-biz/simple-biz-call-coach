/**
 * SBCC v3 live coach (ported from call-coach-hsl CCHv2-ST7): the getRealtimeToken route. It is
 * the only thing between the extension and a billed OpenAI session that receives call audio, so: nobody gets a token unless named in
 * the pilot list, nothing works until the real key is in Secrets Manager, and the key itself
 * never leaves the Lambda.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGetConnection, mockSecretSend, mockCount } = vi.hoisted(() => {
  process.env.AI_GATEWAY_SECRET_ARN = 'arn:test:secret'
  process.env.CONNECTIONS_TABLE = 'test-connections'
  return { mockGetConnection: vi.fn(), mockSecretSend: vi.fn(), mockCount: vi.fn(async () => true) }
})

vi.mock('@infra/lib/lambda/shared/dynamo-client', () => ({
  getConnection: (...a: any[]) => mockGetConnection(...a),
  countRealtimeToken: (...a: any[]) => mockCount(...a),
}))
const { mockParam } = vi.hoisted(() => ({ mockParam: vi.fn() }))
vi.mock('@infra/lib/lambda/shared/secrets-client', () => ({
  getSecretString: async (arn: string) => (await mockSecretSend(arn))?.SecretString ?? '',
  getParameterString: (name: string) => mockParam(name),
}))

import { isRealtimeAllowed } from '@infra/lib/lambda/shared/realtime-policy'
import { parseGatewaySecret } from '@infra/lib/lambda/realtime-token/index'

const KEY = 'vck_' + 'k'.repeat(56)
const event = { requestContext: { connectionId: 'conn-1' } } as any

describe('isRealtimeAllowed (the pilot switch)', () => {
  it('allows nobody by default', () => {
    expect(isRealtimeAllowed('agent@simple.biz', '')).toBe(false)
    expect(isRealtimeAllowed('agent@simple.biz', undefined)).toBe(false)
  })
  it('allows listed agents only, case- and space-insensitive', () => {
    const list = ' Alice@SIMPLE.biz , bob@simple.biz'
    expect(isRealtimeAllowed('alice@simple.biz', list)).toBe(true)
    expect(isRealtimeAllowed('BOB@simple.biz', list)).toBe(true)
    expect(isRealtimeAllowed('carol@simple.biz', list)).toBe(false)
  })
  it('allows everyone with *', () => {
    expect(isRealtimeAllowed('anyone@simple.biz', '*')).toBe(true)
  })
  it('never allows a connection with no agent yet', () => {
    expect(isRealtimeAllowed(undefined, '*')).toBe(false)
  })
})

describe('parseGatewaySecret', () => {
  it('reads a bare key or JSON, and treats junk as empty', () => {
    expect(parseGatewaySecret(` ${KEY}\n`)).toBe(KEY)
    expect(parseGatewaySecret(JSON.stringify({ AI_GATEWAY_API_KEY: KEY }))).toBe(KEY)
    expect(parseGatewaySecret('{not json')).toBe('')
    expect(parseGatewaySecret(undefined)).toBe('')
  })
})

describe('getRealtimeToken handler', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetConnection.mockReset()
    mockSecretSend.mockReset()
    vi.unstubAllGlobals()
  })
  const load = async () => (await import('@infra/lib/lambda/realtime-token/index')).handler

  it('refuses an agent outside the pilot without touching the secret or the gateway', async () => {
    process.env.REALTIME_AGENTS = 'alice@simple.biz'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'carol@simple.biz' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await (await load())(event)
    expect(JSON.parse(res.body)).toMatchObject({ type: 'realtimeToken', ok: false, reason: 'not-enabled' })
    expect(mockSecretSend).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("answers 'no-agent' (retryable) before startConversation has registered the agent", async () => {
    process.env.REALTIME_AGENTS = '*'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1' })
    const res = await (await load())(event)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, reason: 'no-agent' })
    expect(mockSecretSend).not.toHaveBeenCalled()
  })

  it('refuses while the secret still holds the CDK placeholder', async () => {
    process.env.REALTIME_AGENTS = '*'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
    mockSecretSend.mockResolvedValue({ SecretString: 'Xk9-random-placeholder' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await (await load())(event)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, reason: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('mints a short-lived token for a pilot agent and returns only the token', async () => {
    process.env.REALTIME_AGENTS = 'alice@simple.biz'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
    mockSecretSend.mockResolvedValue({ SecretString: KEY })
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ token: 'vcst_abc', expiresAt: 1790000000 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const res = await (await load())(event)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ type: 'realtimeToken', ok: true, token: 'vcst_abc' })
    // the session URL comes from the backend, so the extension never names the model itself
    expect(body.url).toBe('wss://ai-gateway.vercel.sh/v4/ai/realtime-model?ai-model-id=openai%2Fgpt-realtime-mini')
    expect(body.model).toBeUndefined()
    expect(res.body).not.toContain(KEY) // the long-lived key never leaves
    const [url, init] = fetchSpy.mock.calls[0] as any
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/realtime/client-secrets')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'openai/gpt-realtime-mini', expiresIn: 60 })
  })

  describe('pilot list from SSM (switched at runtime, no deploy)', () => {
    beforeEach(() => { process.env.REALTIME_AGENTS_PARAM = '/call-coach/realtime-agents'; mockParam.mockReset() })
    afterEach(() => { delete process.env.REALTIME_AGENTS_PARAM })

    it("treats '-' as nobody", async () => {
      mockParam.mockResolvedValue('-')
      mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
      const body = JSON.parse((await (await load())(event)).body)
      expect(body).toMatchObject({ ok: false, reason: 'not-enabled' })
      expect(mockParam).toHaveBeenCalledWith('/call-coach/realtime-agents')
    })

    it('allows an agent named in the parameter', async () => {
      mockParam.mockResolvedValue('bob@simple.biz, alice@simple.biz')
      mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
      mockSecretSend.mockResolvedValue({ SecretString: KEY })
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'vcst_p' }), { status: 200 })))
      expect(JSON.parse((await (await load())(event)).body)).toMatchObject({ ok: true, token: 'vcst_p' })
    })

    it('fails closed when the parameter cannot be read (e.g. not created yet)', async () => {
      mockParam.mockRejectedValue(new Error('ParameterNotFound'))
      mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(JSON.parse((await (await load())(event)).body)).toMatchObject({ ok: false, reason: 'not-enabled' })
      err.mockRestore()
    })
  })

  it('refuses once the connection hit its token cap, before touching the gateway', async () => {
    process.env.REALTIME_AGENTS = '*'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
    mockSecretSend.mockResolvedValue({ SecretString: KEY })
    mockCount.mockResolvedValueOnce(false)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const body = JSON.parse((await (await load())(event)).body)
    expect(body).toMatchObject({ ok: false, reason: 'limit' })
    expect(mockCount).toHaveBeenCalledWith('conn-1', 40)
    expect(fetchSpy).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reports a gateway refusal without a token', async () => {
    process.env.REALTIME_AGENTS = '*'
    mockGetConnection.mockResolvedValue({ connectionId: 'conn-1', agentId: 'alice@simple.biz' })
    mockSecretSend.mockResolvedValue({ SecretString: KEY })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no credits', { status: 402 })))
    const body = JSON.parse((await (await load())(event)).body)
    expect(body).toMatchObject({ ok: false, reason: 'gateway-402' })
    expect(body.token).toBeUndefined()
  })
})
