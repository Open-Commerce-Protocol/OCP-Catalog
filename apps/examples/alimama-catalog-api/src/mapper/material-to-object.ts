/**
 * Mapper: 阿里妈妈 material.optional 单条商品 → OCP-style catalog item.
 *
 * 这是 "用 OCP Catalog 包阿里妈妈" 翻译适配层的核心翻译函数。
 *
 * 翻译规则（详见 docs/05-implementation.md §3 / 06-coding-flow.md Step 1.5）：
 *   - title / image_urls / product_url → ocp.commerce.product.core.v1
 *   - reserve_price / zk_final_price   → ocp.commerce.price.v1 (CNY)
 *   - 库存 (alimama 不返)               → ocp.commerce.inventory.v1 (availability_status='unknown')
 *   - PID / 佣金率 / 券 / 平台          → product.core.v1.attributes (自由扩展字段)
 *
 * 关键不变量（被单测固化）：
 *   1. 所有 image_urls 都是绝对 https:// URL
 *   2. price 字段是 number 而非 string
 *   3. affiliate metadata stays descriptive; dynamic purchase actions are minted by /ocp/resolve
 *   4. 缺失的可选字段被优雅省略而不是写 undefined
 */
import type { AlimamaMaterialItem } from '../alimama/types';

export interface MapperContext {
  /** Source connector id inside this Catalog Node. */
  sourceId: string;
  /** Catalog public base URL. */
  catalogBaseUrl: string;
}

/** 与 OCP CommercialObject 协议对齐的对象形状（描述性，运行时由 OCP catalog 校验） */
export interface CommercialObject {
  ocp_version: '1.0';
  kind: 'CommercialObject';
  id: string;
  object_id: string;
  object_type: 'product';
  provider_id: string;
  title: string;
  status: 'active' | 'inactive' | 'draft';
  source_url?: string;
  descriptors: Descriptor[];
}

export interface Descriptor {
  pack_id: string;
  data: Record<string, unknown>;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 把 URL 绝对化（处理阿里 CDN 常见的 `//gw.alicdn.com/...` 无 scheme 形式）。
 * - 已是绝对 URL：原样返回
 * - 以 // 开头：补 https:
 * - 空 / 无效：返 undefined（调用方过滤）
 */
export function absolutize(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  // 兜底：当成 https
  return 'https://' + trimmed;
}

/** 安全解析价格字符串（"199.00" / "29" / "" / 异常输入）。返回 0 作为 POA fallback */
export function safePrice(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ============================================================
// Mapper 主体
// ============================================================

export function mapMaterialToCommercialObject(
  m: AlimamaMaterialItem,
  ctx: MapperContext,
): CommercialObject {
  const productUrl = absolutize(m.item_url);

  // 1. 图片：主图 + 副图，全部绝对化，过滤掉 undefined
  const smallImages = m.small_images?.string ?? [];
  const imageUrls = [m.pict_url, ...smallImages]
    .map((u) => absolutize(u))
    .filter((u): u is string => !!u);

  // 2. 平台标记
  const platform = m.user_type === 1 ? 'tmall' : 'taobao';

  // 3. 类目：优先 category_id（数字），其次 cat 字符串
  const category =
    m.category_id !== undefined && m.category_id !== null
      ? String(m.category_id)
      : (m.cat ?? '');

  // 4. 券（无券则 null）
  const coupon = m.coupon_info
    ? {
        info: m.coupon_info,
        starts_at: m.coupon_start_time ?? null,
        ends_at: m.coupon_end_time ?? null,
        remain_count: m.coupon_remain_count ?? null,
        total_count: m.coupon_total_count ?? null,
      }
    : null;

  // 5. attributes（自由扩展字段都塞这里）
  const attributes: Record<string, unknown> = {
    platform,
    sales_volume_30d: m.volume ?? null,
    commission_rate_bp: m.commission_rate ?? null,
    tk_sales_30d: m.tk_total_sales ?? null,
    coupon,
    affiliate_source: 'alimama_taobao_union',
  };

  // 6. 拼装 CommercialObject
  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.sourceId}_${m.num_iid}`,
    object_id: String(m.num_iid),
    object_type: 'product',
    provider_id: ctx.sourceId,
    title: m.title,
    status: 'active',
    ...(productUrl ? { source_url: productUrl } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: m.title,
          ...(m.shop_title ? { brand: m.shop_title } : {}),
          ...(category ? { category } : {}),
          sku: String(m.num_iid),
          ...(productUrl ? { product_url: productUrl } : {}),
          image_urls: imageUrls,
          attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: 'CNY',
          amount: safePrice(m.zk_final_price),
          list_amount: safePrice(m.reserve_price),
          price_type: 'fixed',
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: 'unknown',
        },
      },
    ],
  };
}
