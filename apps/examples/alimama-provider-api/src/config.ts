/**
 * alimama-provider-api 的 env 配置。
 *
 * 用 zod 校验:启动期就 fail-fast,而不是运行时神秘 undefined。
 */
import { z } from 'zod';

const configSchema = z.object({
  // ============ OCP Catalog 相关 ============
  /** 上游 OCP Catalog 服务的 base URL，如 http://localhost:4000 */
  OCP_CATALOG_BASE_URL: z.string().url(),

  /** 上游 catalog 的 ID（写进 ProviderRegistration.catalog_id），默认匹配 OCP-Catalog .env 的 CATALOG_ID */
  OCP_CATALOG_ID: z.string().min(1).default('cat_local_dev'),

  /** 本 Provider 在 OCP 体系中的标识 */
  OCP_PROVIDER_ID: z.string().min(1),

  /** 与 OCP catalog 通讯的 API Key（x-api-key header） */
  OCP_API_KEY: z.string().min(1),

  /** 本服务对外可访问的 base URL（写进 attributes.provider_resolve_hook_url） */
  OCP_PROVIDER_BASE_URL: z.string().url(),

  /** 本服务监听端口 */
  PROVIDER_PORT: z.coerce.number().int().positive().default(4300),

  // ============ Alimama 相关 ============
  /** mock 模式：不调真实 alimama，全部走 fixture。默认 true 利于本地开发 */
  ALIMAMA_MOCK: z
    .string()
    .optional()
    .transform((s) => s === 'true')
    .pipe(z.boolean())
    .default(true),

  /** 阿里 AppKey（mock=false 时必须） */
  ALIMAMA_APP_KEY: z.string().optional(),

  /** 阿里 AppSecret（mock=false 时必须） */
  ALIMAMA_APP_SECRET: z.string().optional(),

  /** 推广位 ID（PoC 阶段共用 1 个） */
  ALIMAMA_ADZONE_ID: z.string().default('mock_adzone_001'),

  /** 阿里网关 base URL（生产可指向沙箱 / 代理） */
  ALIMAMA_BASE_URL: z.string().url().default('https://gw.api.taobao.com/router/rest'),

  // ============ 行为开关 ============
  /** 启动后自动跑 cron 拉物料（生产开 true，本地 PoC 通常 false） */
  OCP_AUTO_SYNC: z
    .string()
    .optional()
    .transform((s) => s === 'true')
    .pipe(z.boolean())
    .default(false),

  /** Material poller 间隔(秒);0 = 关闭 */
  MATERIAL_POLL_INTERVAL_SEC: z.coerce.number().int().min(0).default(0),

  /** Order poller 间隔(秒);0 = 关闭 */
  ORDER_POLL_INTERVAL_SEC: z.coerce.number().int().min(0).default(0),

  /** Material poller 默认搜索关键词 */
  MATERIAL_POLL_QUERY: z.string().default(''),

  /** Material poller 单次拉取数量 */
  MATERIAL_POLL_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(20),
});

export type AlimamaConfig = z.infer<typeof configSchema>;

/**
 * 从 process.env 解析配置。
 * - schema 校验失败 → 抛 ZodError
 * - 业务规则失败（mock=false 但缺 AppKey）→ 抛 Error
 */
export function loadAlimamaConfig(env: NodeJS.ProcessEnv = process.env): AlimamaConfig {
  const parsed = configSchema.parse(env);
  if (!parsed.ALIMAMA_MOCK) {
    if (!parsed.ALIMAMA_APP_KEY || !parsed.ALIMAMA_APP_SECRET) {
      throw new Error(
        'ALIMAMA_MOCK=false 时必须同时提供 ALIMAMA_APP_KEY 和 ALIMAMA_APP_SECRET',
      );
    }
  }
  return parsed;
}
