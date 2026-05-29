import { z } from 'zod';

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'))
  .pipe(z.boolean().optional());

const configSchema = z.object({
  // ---- Catalog Node 自身身份 ----
  PDD_CATALOG_ID: z.string().min(1).default('cat_pdd_affiliate'),
  PDD_CATALOG_NAME: z.string().min(1).default('PDD Duoduojinbao Affiliate Catalog'),
  PDD_CATALOG_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4330'),
  PDD_CATALOG_ADMIN_KEY: z.string().min(8).default('dev-pdd-admin-key'),
  PDD_CATALOG_PORT: z.coerce.number().int().positive().default(4330),

  // ---- 上游 PDD 多多客凭据 ----
  // mock=true 时凭据可缺;mock=false 时强校验 ClientId/Secret/Pid
  PDD_MOCK: booleanFromEnv.default(true),
  /**
   * PDD 开放平台应用的 client_id (等价于 alimama AppKey)。
   * 在 open.pinduoduo.com 创建多多进宝应用后获得。
   */
  PDD_CLIENT_ID: z.string().optional(),
  PDD_CLIENT_SECRET: z.string().optional(),
  /**
   * 推广位 ID,形如 "26829999_278234567"。
   * 由 member_id_position_id 组合而成,在多多进宝后台手动建。
   * 等价于 alimama adzone_id / JD positionId。
   */
  PDD_PID: z.string().default('mock_pid_001'),

  /** PDD 联盟网关地址 */
  PDD_BASE_URL: z.string().url().default('https://gw-api.pinduoduo.com/api/router'),

  // ---- 行为开关 ----
  PDD_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  PDD_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  PDD_ORDER_POLL_INTERVAL_SEC: z.coerce.number().int().min(0).default(0),

  /**
   * 转链时是否把 OCP entry_id / agent_id 塞进 custom_parameters。
   *   - 'enabled' (默认): 转链时透传,订单回流时能在 custom_parameters 字段
   *      反查到 entry_id 和 agent_id,实现 by_agent 聚合
   *   - 'disabled': 不透传,所有订单 agentExternalId=null,by_agent 失去意义
   */
  PDD_CUSTOM_PARAMS_MODE: z.enum(['enabled', 'disabled']).default('enabled'),
});

export type PddConfig = z.infer<typeof configSchema>;

export function loadPddConfig(env: NodeJS.ProcessEnv = process.env): PddConfig {
  const parsed = configSchema.parse(env);
  if (!parsed.PDD_MOCK) {
    if (!parsed.PDD_CLIENT_ID || !parsed.PDD_CLIENT_SECRET) {
      throw new Error('PDD_MOCK=false requires PDD_CLIENT_ID and PDD_CLIENT_SECRET');
    }
    if (!parsed.PDD_PID || parsed.PDD_PID === 'mock_pid_001') {
      throw new Error('PDD_MOCK=false requires a real PDD_PID (not the mock default)');
    }
  }
  return parsed;
}
