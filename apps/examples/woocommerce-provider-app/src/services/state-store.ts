import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ProviderState {
  active_registration_version: number | null;
  last_synced_at: string | null;
  last_run: {
    type: 'register' | 'sync_full' | 'sync_delta' | 'sync_one' | 'webhook' | null;
    status: 'succeeded' | 'failed' | 'partial' | 'running' | null;
    started_at: string | null;
    finished_at: string | null;
    objects_synced: number;
    error?: string | null;
  };
}

const INITIAL: ProviderState = {
  active_registration_version: null,
  last_synced_at: null,
  last_run: { type: null, status: null, started_at: null, finished_at: null, objects_synced: 0 },
};

export class StateStore {
  private state: ProviderState = structuredClone(INITIAL);
  private loaded = false;
  constructor(private readonly path: string | undefined) {}

  async load(): Promise<ProviderState> {
    if (this.loaded) return this.state;
    if (this.path && existsSync(this.path)) {
      const text = await readFile(this.path, 'utf-8');
      try { this.state = { ...INITIAL, ...(JSON.parse(text) as Partial<ProviderState>) }; } catch {}
    }
    this.loaded = true;
    return this.state;
  }

  async snapshot(): Promise<ProviderState> {
    await this.load();
    return structuredClone(this.state);
  }

  async update(patch: Partial<ProviderState>): Promise<ProviderState> {
    await this.load();
    this.state = { ...this.state, ...patch, last_run: { ...this.state.last_run, ...(patch.last_run ?? {}) } };
    if (this.path) {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.state, null, 2));
    }
    return this.state;
  }
}
