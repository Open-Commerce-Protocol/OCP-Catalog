/**
 * Mapper: PDD goods.search 单条商品 → OCP-style CommercialObject。
 *
 * 与 alimama / JD 同位 mapper 的差异点 (这是 PDD 最值得记的几条):
 *   - PDD 价格是**整数分** (min_group_price=249900 表示 ¥2499.00),mapper 必须 /100
 *   - PDD promotion_rate 是**千分位** (50 表示 5.0%),换算成 basis points 需要 ×10
 *   - PDD 时间是 **Unix 秒** (不是 alimama 字符串、不是 JD 毫秒),converter 要 ×1000 再 toISOString
 *   - PDD 图片**已自带 https://** (img.pddpic.com),不需要 alimama / JD 那种 // 兜底
 *     但 absolutize 防御性保留,真实环境偶尔会有 // 开头的图
 *   - PDD goods.search 不返回商品落地页 URL,需要从 goods_id 拼 mobile.yangkeduo.com
 *   - PDD 没有 isBest 标记,多张券时取第一条
 *   - merchant_type: 1=个人 2=企业 3=旗舰 4=专卖 5=专营,attributes 里暴露给 OCP 过滤
 *
 * 关键不变量 (与 alimama / JD 对齐,由单测固化):
 *   1. 所有 image_urls 都是绝对 https:// URL
 *   2. price 字段是 number 而非 string,**单位是元 (不是分)**
 *   3. affiliate metadata 只在 attributes 描述性出现,真正的购买 URL 由 resolve 动态产出
 *   4. 缺失的可选字段被优雅省略而不是写 undefined
 */
import type { PddGoodsItem } from '../pdd/types';

export interface MapperContext {
  /** Source connector id (Catalog Node 内部 source identifier) */
  sourceId: string;
  /** Catalog public base URL */
  catalogBaseUrl: string;
}

/** 与 OCP CommercialObject 协议对齐的对象形状 */
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
 * 把 URL 绝对化。PDD 图片已经自带 https://,这个函数主要是防御性兜底,
 * 与 alimama / JD 等价。
 */
export function absolutize(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

/** 整数分 → 元 (number,保留 2 位小数);非法值返 0 */
export function fenToYuan(v: number | null | undefined): number {
  if (v === undefined || v === null || !Number.isFinite(v)) return 0;
  return Math.round(v) / 100;
}

/** Unix 秒 → 'YYYY-MM-DD';非法值返 null */
function secToDate(sec: number | undefined | null): string | null {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** 类目: cat_name (PDD 优先) → category_name → cat_id 数字兜底 */
function pickCategory(g: PddGoodsItem): string {
  return (
    g.cat_name ??
    g.category_name ??
    (g.cat_id !== undefined ? String(g.cat_id) : '') ??
    (g.category_id !== undefined ? String(g.category_id) : '')
  );
}

/**
 * PDD merchant_type 数字 → 人类可读标签。
 *   1=个人店  2=企业店  3=旗舰店  4=专卖店  5=专营店
 */
function pickMerchantType(
  t: number | undefined,
): 'personal' | 'enterprise' | 'flagship' | 'exclusive' | 'specialty' | undefined {
  switch (t) {
    case 1: return 'personal';
    case 2: return 'enterprise';
    case 3: return 'flagship';
    case 4: return 'exclusive';
    case 5: return 'specialty';
    default: return undefined;
  }
}

/** 从 goods_id 拼出商品落地页 (非 affiliate) */
function buildProductUrl(goodsId: number | string): string {
  return `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}`;
}

// ============================================================
// Mapper 主体
// ============================================================

export function mapGoodsToCommercialObject(
  g: PddGoodsItem,
  ctx: MapperContext,
): CommercialObject {
  const productUrl = buildProductUrl(g.goods_id);

  // 1. 图片: goods_image_url + goods_thumbnail_url + goods_gallery_urls,绝对化 + dedupe
  const rawImages = [
    g.goods_image_url,
    g.goods_thumbnail_url,
    ...(g.goods_gallery_urls ?? []),
  ];
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const raw of rawImages) {
    const abs = absolutize(raw);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      imageUrls.push(abs);
    }
  }

  // 2. 平台标记
  const platform = 'pdd';

  // 3. 类目
  const category = pickCategory(g);

  // 4. 价格 (PDD 是分,换算成元 number)
  //    amount 优先用 min_group_price (拼团/券后价),fallback 到 min_normal_price
  //    list_amount 用 min_normal_price (单买价,即"原价")
  const amount = fenToYuan(g.min_group_price ?? g.min_normal_price);
  const listAmount = fenToYuan(g.min_normal_price ?? g.min_group_price);

  // 5. 券: PDD 没有 isBest,直接看 has_coupon + coupon_* 字段是否齐全
  const coupon = g.has_coupon && g.coupon_discount !== undefined
    ? {
        info:
          g.coupon_min_order_amount !== undefined && g.coupon_discount !== undefined
            ? `满 ${fenToYuan(g.coupon_min_order_amount)} 元减 ${fenToYuan(g.coupon_discount)} 元`
            : null,
        discount_yuan: fenToYuan(g.coupon_discount),
        quota_yuan: fenToYuan(g.coupon_min_order_amount),
        starts_at: secToDate(g.coupon_start_time),
        ends_at: secToDate(g.coupon_end_time),
        remain_count: g.coupon_remain_quantity ?? null,
        total_count: g.coupon_total_quantity ?? null,
      }
    : null;

  // 6. 佣金率: PDD 是千分位 (50=5.0%),换算成基点 (500 bp) 对齐 alimama / JD
  const commissionRateBp =
    g.promotion_rate !== undefined
      ? Math.round(g.promotion_rate * 10)
      : null;

  // 7. attributes
  const merchantType = pickMerchantType(g.merchant_type);
  const attributes: Record<string, unknown> = {
    platform,
    sales_volume_30d: g.sold_quantity ?? null,
    sales_tip: g.sales_tip ?? null,
    commission_rate_bp: commissionRateBp,
    coupon,
    affiliate_source: 'pdd_duoduojinbao',
    ...(merchantType ? { pdd_merchant_type: merchantType } : {}),
    ...(g.mall_name ? { mall_name: g.mall_name } : {}),
    ...(g.goods_sign ? { goods_sign: g.goods_sign } : {}),
  };

  // 8. 拼装 CommercialObject
  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.sourceId}_${g.goods_id}`,
    object_id: String(g.goods_id),
    object_type: 'product',
    provider_id: ctx.sourceId,
    title: g.goods_name,
    status: 'active',
    source_url: productUrl,
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: g.goods_name,
          ...(g.brand_name ? { brand: g.brand_name } : {}),
          ...(category ? { category } : {}),
          sku: String(g.goods_id),
          product_url: productUrl,
          image_urls: imageUrls,
          attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: 'CNY',
          amount,
          list_amount: listAmount,
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
