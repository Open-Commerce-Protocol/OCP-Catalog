export class TtlCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();

  get(key: string) {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.values.delete(key);
      return null;
    }

    return hit.value;
  }

  set(key: string, value: T, ttlMs: number) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
