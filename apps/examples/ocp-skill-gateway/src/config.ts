import { z } from 'zod';

const catalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  base_url: z.string().url(),
});

const catalogsFromEnv = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return z.array(catalogEntrySchema).parse(parsed);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `SKILL_GATEWAY_CATALOGS 不是合法 JSON 数组: ${err instanceof Error ? err.message : 'unknown'}`,
      });
      return z.NEVER;
    }
  });

const csvSet = z
  .string()
  .default('')
  .transform((raw) => new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)));

const configSchema = z.object({
  SKILL_GATEWAY_PORT: z.coerce.number().int().positive().default(4330),
  SKILL_GATEWAY_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4330'),

  SKILL_GATEWAY_API_KEYS: csvSet,

  SKILL_GATEWAY_CATALOGS: catalogsFromEnv,

  /**
   * 上游数据源开关。
   *   ocp_mcp        线上 ocp.deeplumen.io/mcp 注册中心(默认,真实数据)
   *   local_catalogs 本地 SKILL_GATEWAY_CATALOGS 列表(离线 / mock 联调)
   */
  SKILL_GATEWAY_UPSTREAM: z.enum(['ocp_mcp', 'local_catalogs']).default('ocp_mcp'),

  /** OCP 注册中心 MCP server 入口,仅当 SKILL_GATEWAY_UPSTREAM=ocp_mcp 时生效。 */
  SKILL_GATEWAY_OCP_MCP_URL: z.string().url().default('https://ocp.deeplumen.io/mcp'),

  SKILL_GATEWAY_FANOUT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  SKILL_GATEWAY_TELEMETRY_SINK: z.enum(['in-memory', 'jsonl']).default('in-memory'),
  SKILL_GATEWAY_TELEMETRY_JSONL_PATH: z.string().default('./var/telemetry.jsonl'),
});

export type SkillGatewayConfig = z.infer<typeof configSchema>;

export function loadSkillGatewayConfig(): SkillGatewayConfig {
  return configSchema.parse(process.env);
}
