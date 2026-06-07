import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';

export type AdvisoryLockResult<T> =
  | {
    acquired: true;
    value: T;
  }
  | {
    acquired: false;
  };

export interface AdvisoryLockService {
  withLock<T>(lockName: string, fn: () => Promise<T>): Promise<AdvisoryLockResult<T>>;
}

export class PostgresAdvisoryLockService implements AdvisoryLockService {
  private readonly sql: postgres.Sql;
  private readonly locallyHeldLocks = new Set<string>();

  constructor(databaseUrl = loadConfig().DATABASE_URL) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async withLock<T>(lockName: string, fn: () => Promise<T>): Promise<AdvisoryLockResult<T>> {
    if (this.locallyHeldLocks.has(lockName)) return { acquired: false };
    this.locallyHeldLocks.add(lockName);

    let acquired = false;
    try {
      [{ acquired }] = await this.sql<Array<{ acquired: boolean }>>`
        select pg_try_advisory_lock(hashtextextended(${lockName}, 0)) as acquired
      `;
    } catch (error) {
      this.locallyHeldLocks.delete(lockName);
      throw error;
    }

    if (!acquired) {
      this.locallyHeldLocks.delete(lockName);
      return { acquired: false };
    }

    try {
      return {
        acquired: true,
        value: await fn(),
      };
    } finally {
      try {
        const [{ released }] = await this.sql<Array<{ released: boolean }>>`
          select pg_advisory_unlock(hashtextextended(${lockName}, 0)) as released
        `;
        if (!released) {
          throw new Error(`Postgres advisory lock ${lockName} was not released by this session`);
        }
      } finally {
        this.locallyHeldLocks.delete(lockName);
      }
    }
  }

  async close() {
    await this.sql.end();
  }
}
