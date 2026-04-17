/**
 * Fallback Utilities
 *
 * Shared helpers for the OpenAI-as-fallback pattern when Anthropic is unavailable.
 */

/**
 * Determines whether a given error should trigger failover to OpenAI.
 *
 * Returns true for: Anthropic 5xx, 529 overloaded, timeouts, connection errors.
 * Returns false for: 4xx client errors (our bugs), 429 rate limits (backoff instead).
 */
export function shouldFallback(err: any): boolean {
  if (!err) return false;

  // HTTP status codes from Anthropic SDK
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number') {
    if (status >= 500) return true;   // 500, 502, 503, 504
    if (status === 529) return true;  // Anthropic overloaded
    // 4xx and 429 → do not fall back
    return false;
  }

  // Node errors / SDK errors without status code
  if (err?.name === 'TimeoutError') return true;
  if (err?.code === 'ECONNRESET') return true;
  if (err?.code === 'ENOTFOUND') return true;
  if (err?.code === 'ETIMEDOUT') return true;
  if (err?.code === 'ECONNREFUSED') return true;
  if (err?.code === 'EAI_AGAIN') return true;

  // Anthropic SDK's APIConnectionError / APIError base
  const errorName = err?.constructor?.name || err?.name;
  if (errorName === 'APIConnectionError') return true;
  if (errorName === 'APIConnectionTimeoutError') return true;

  return false;
}

/**
 * Wraps a promise with a timeout. Rejects with a TimeoutError if the timeout fires first.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'operation'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Structured CloudWatch log entry for fallback events.
 * Easy to search in CloudWatch Logs Insights with filter: [FALLBACK]
 */
export function logFallback(feature: 'tip' | 'intelligence', reason: string, details?: Record<string, any>): void {
  const payload = {
    feature,
    reason,
    timestamp: new Date().toISOString(),
    ...details,
  };
  console.warn(`[FALLBACK] OpenAI used for ${feature} — ${JSON.stringify(payload)}`);
}

/**
 * Testing flags — read once at module load for performance.
 * Set these via Lambda environment variables in AWS Console (temporary) to exercise code paths.
 */
export const FORCE_OPENAI_FALLBACK = process.env.FORCE_OPENAI_FALLBACK === 'true';
export const FAIL_ANTHROPIC_CALLS = process.env.FAIL_ANTHROPIC_CALLS === 'true';

/**
 * Default timeout budget for Anthropic calls before falling back.
 * 5s gives Anthropic plenty of time under normal load while still bounding user wait.
 */
export const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '5000', 10);
