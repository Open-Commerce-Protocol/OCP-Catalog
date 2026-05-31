import { z } from 'zod';

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'))
  .pipe(z.boolean().optional());

const configSchema = z.object({
  // ---- Catalog Node 自身身份 ----
  JDUNION_CATALOG_ID: z.string().min(1).default('cat_jdunion_affiliate'),
  JDUNION_CATALOG_NAME: z.string().min(1).default('JD Union Affiliate Catalog'),
  JDUNION_CATALOG_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4320'),
  JDUNION_CATALOG_ADMIN_KEY: z.string().min(8).default('dev-jdunion-admin-key'),
  JDUNION_CATALOG_PORT: z.coerce.number().int().positive().default(4320),

  // ---- 上游 JD 联盟凭据 ----
  // mock=true 时凭据可缺;mock=false 时强校验 AppKey/Secret/UnionId
  JDUNION_MOCK: booleanFromEnv.default(true),
  JDUNION_APP_KEY: z.string().optional(),
  JDUNION_APP_SECRET: z.string().optional(),
  /**
   * 联盟 ID(union_id),标识联盟账号主体;real 模式必填。
   * 与 positionId 一起决定订单归因。
   */
  JDUNION_UNION_ID: z.string().optional(),
  /**
   * 推广位 ID(position_id),订单归因的最小原子(等价于阿里 adzone_id)。
   * mock 模式给个占位默认值;real 模式至少建好 1 个。
   */
  JDUNION_POSITION_ID: z.string().default('mock_position_001'),

  /**
   * 媒体 ID(media_id),"工具商 / Agent贸易"账号特有。
   * 当存在时,PID 走 3 段形式 `{union_id}_{media_id}_{position_id}`,
   * 这是 union.jd.com 推广位详情页给出的"PID"字段。
   * 标准联盟账号留空即可,PID 退化为 2 段 `{union_id}_{position_id}`。
   */
  JDUNION_MEDIA_ID: z.string().optional(),

  /**
   * siteId,工具商 promotion.common.get 等接口要求传(网关报 1002024 "siteId不能为空")。
   * 工具商账号在推广位详情页能看到,通常等于 media_id;留空时退回 media_id 或 position_id。
   */
  JDUNION_SITE_ID: z.string().optional(),

  /**
   * JD 联盟网关地址。
   * 注意:JD 实际有 2 个 JOS 网关:
   *   - https://router.jd.com/api  — 老网关,部分早期开发者账号在此
   *   - https://api.jd.com/routerjson — 新网关,"导购媒体/Agent贸易"类账号在此
   * 真实联调时如果报 code=12 "无效签名" 但 debug 脚本显示签名算法正确,
   * 第一时间切换到另一个网关试试。
   */
  JDUNION_BASE_URL: z.string().url().default('https://api.jd.com/routerjson'),

  // ---- 行为开关 ----
  JDUNION_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  JDUNION_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  JDUNION_ORDER_POLL_INTERVAL_SEC: z.coerce.number().int().min(0).default(0),

  /**
   * Resolve 实现分支:
   *   - 'goods_promotion' (默认): 调 jd.union.open.goods.promotiongoodsinfo.query
   *     单 API 拿到单品 + shortURL,与 alimama 用 material.optional.upgrade 的策略同构
   *   - 'promotion_common': 调 jd.union.open.promotion.common.get 显式转链
   *     字段最稳态但要多一次 API
   */
  JDUNION_RESOLVE_STRATEGY: z
    .enum(['goods_promotion', 'promotion_common'])
    .default('goods_promotion'),
});

export type JdUnionConfig = z.infer<typeof configSchema>;

export function loadJdUnionConfig(env: NodeJS.ProcessEnv = process.env): JdUnionConfig {
  const parsed = configSchema.parse(env);
  if (!parsed.JDUNION_MOCK) {
    if (!parsed.JDUNION_APP_KEY || !parsed.JDUNION_APP_SECRET) {
      throw new Error('JDUNION_MOCK=false requires JDUNION_APP_KEY and JDUNION_APP_SECRET');
    }
    if (!parsed.JDUNION_UNION_ID) {
      throw new Error('JDUNION_MOCK=false requires JDUNION_UNION_ID');
    }
  }
  return parsed;
}
