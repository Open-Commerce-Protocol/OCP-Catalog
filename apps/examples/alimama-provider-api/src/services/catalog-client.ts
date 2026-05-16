/**
 * OCP Catalog HTTP 客户端。
 *
 * 负责与上游 commerce-catalog-api 通讯，提供两个核心方法：
 *   - registerProvider(): 把本 alimama-provider 注册成 OCP Provider
 *   - syncObjects():      把映射后的 CommercialObject 推送到 catalog 入库
 *
 * 认证：x-api-key header（dev 阶段统一是 dev-api-key）。
 */
import type { AlimamaConfig } from '../config';

export class OcpCatalogError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'OcpCatalogError';
  }
}

export class OcpCatalogClient {
  constructor(private readonly cfg: AlimamaConfig) {}

  /** 注册或更新 Provider 在 catalog 中的元信息和契约 */
  async registerProvider(registration: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/ocp/providers/register', registration);
  }

  /**
   * 批量同步 CommercialObject 到 catalog。
   * 单批 ≤ 100 个对象，超过需要调用方自己拆批。
   */
  async syncObjects(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/ocp/objects/sync', request);
  }

  /** 查询 Provider 当前状态（registration_version、health 等） */
  async getProvider(providerId: string): Promise<Record<string, unknown>> {
    return this.get(`/ocp/providers/${encodeURIComponent(providerId)}`);
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.request(path, { method: 'POST', body });
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    return this.request(path, { method: 'GET' });
  }

  private async request(
    path: string,
    opts: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const url = `${this.cfg.OCP_CATALOG_BASE_URL.replace(/\/$/, '')}${path}`;
    const init: RequestInit = {
      method: opts.method,
      headers: {
        'x-api-key': this.cfg.OCP_API_KEY,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    };

    const res = await fetch(url, init);
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new OcpCatalogError(
        res.status,
        `OCP Catalog ${opts.method} ${path} failed: ${res.status} ${res.statusText}`,
        payload,
      );
    }

    return payload as Record<string, unknown>;
  }
}
