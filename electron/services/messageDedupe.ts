/**
 * 带 TTL 的键缓存：消息去重用（同一 messageKey 在 TTL 内只推送一次）。
 * 定期惰性清理，避免长期驻留时无限增长。
 */
export class TtlKeyCache {
  private readonly entries = new Map<string, number>()
  private readonly ttlMs: number

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  has(key: string): boolean {
    this.prune()
    const timestamp = this.entries.get(key)
    return typeof timestamp === 'number' && Date.now() - timestamp < this.ttlMs
  }

  remember(key: string): void {
    this.entries.set(key, Date.now())
    this.prune()
  }

  clear(): void {
    this.entries.clear()
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, timestamp] of this.entries.entries()) {
      if (now - timestamp > this.ttlMs) this.entries.delete(key)
    }
  }
}
