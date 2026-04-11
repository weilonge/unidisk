/**
 * An error that carries a hint to the retry loop about how long to wait
 * before the next attempt.  Providers throw this when they receive an
 * explicit throttle response so that UdManager can back off appropriately
 * without embedding provider-specific logic.
 */
export class RetryableError extends Error {
  constructor(message: string, public readonly retryAfter: number) {
    super(message)
    this.name = 'RetryableError'
  }
}
