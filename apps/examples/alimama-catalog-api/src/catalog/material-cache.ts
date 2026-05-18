import type { AlimamaMaterialItem } from '../alimama/types';

type CachedMaterial = {
  item: AlimamaMaterialItem;
  expiresAt: number;
};

export class MaterialResolveCache {
  private readonly entries = new Map<string, CachedMaterial>();

  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  set(entryId: string, item: AlimamaMaterialItem) {
    this.entries.set(entryId, {
      item,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(entryId: string): AlimamaMaterialItem | null {
    const cached = this.entries.get(entryId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.entries.delete(entryId);
      return null;
    }
    return cached.item;
  }
}
