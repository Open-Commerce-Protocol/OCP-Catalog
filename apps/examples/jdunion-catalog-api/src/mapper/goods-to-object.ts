/**
 * Mapper: JD 联盟 goods.query 单条商品 → OCP-style CommercialObject。
 *
 * 与 alimama material-to-object 同构,差异点:
 *   - JD 图片是 `//img14.360buyimg.com/...` 无 scheme 形态 → absolutize 加 https:
 *   - JD 价格全是 number,**不需要** parseFloat (省去 alimama 的 safePrice 容错路径)
 *   - JD 佣金率 commissionShare 是百分数 number (3.0 表示 3%),attributes 里
 *     沿用 alimama 的 commission_rate_bp 命名 → 需要 ×100 换算成基点
 *   - JD 平台标记直接为 'jd' (没有 tmall/taobao 那种细分)
 *   - JD 类目优先用 cid3Name (最具体) → cid2Name → cid3 (number) 兜底
 *   - JD 券是数组 couponList[],选 isBest=1 那条,没有 isBest 就第一条
 *
 * 关键不变量 (与 alimama 对齐,由单测固化):
 *   1. 所有 image_urls 都是绝对 https:// URL
 *   2. price 字段是 number
 *   3. affiliate metadata 只在 attributes 描述性出现,真正的购买 URL 由 resolve 阶段动态产出
 *   4. 缺失的可选字段被优雅省略而不是写 undefined
 */
import type { JdGoodsItem } from '../jd/types';

export interface MapperContext {
  /** Source connector id (Catalog Node 内部 source identifier) */
  sourceId: string;
  /** Catalog public base URL */
  catalogBaseUrl: string;
}

/** 与 OCP CommercialObject 协议对齐的对象形状 (描述性,运行时由 OCP catalog 校验) */
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
 * 把 URL 绝对化 (处理 JD CDN 常见的 `//img14.360buyimg.com/...` 无 scheme 形式)。
 * 与 alimama absolutize 同实现 (保持 example 间不耦合,各自维护)。
 */
export function absolutize(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

/** unix 毫秒 → 'YYYY-MM-DD' (北京时区);非法值返 null */
function msToDate(ms: number | undefined | null): string | null {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return null;
  const beijingMs = ms + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().slice(0, 10);
}

/**
 * JD 类目: cid3Name (最具体) → cid2Name → cid1Name → cid3 (number) 兜底。
 * 任何字段都没有时返空串。
 */
function pickCategory(g: JdGoodsItem): string {
  const c = g.categoryInfo;
  if (!c) return '';
  return (
    c.cid3Name ??
    c.cid2Name ??
    c.cid1Name ??
    (c.cid3 !== undefined ? String(c.cid3) : '')
  );
}

/**
 * JD owner 字段: 'g' = 自营,'p' = POP 第三方店铺。
 * 没传时返 undefined,attributes 里不出现该字段。
 */
function pickOwnerLabel(owner: string | undefined): 'self_operated' | 'pop' | undefined {
  if (owner === 'g') return 'self_operated';
  if (owner === 'p') return 'pop';
  return undefined;
}

// ============================================================
// Mapper 主体
// ============================================================

export function mapGoodsToCommercialObject(
  g: JdGoodsItem,
  ctx: MapperContext,
): CommercialObject {
  const productUrl = absolutize(g.materialUrl);

  // 1. 图片: imageList + whiteImage,全部绝对化,过滤 undefined,dedupe
  const rawImages = [
    ...(g.imageInfo?.imageList?.map((i) => i.url) ?? []),
    g.imageInfo?.whiteImage ?? undefined,
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

  // 2. 平台
  const platform = 'jd';

  // 3. 类目
  const category = pickCategory(g);

  // 4. 价格 (number,无需 parseFloat)
  //    amount 优先用 lowestPrice (当前最低/券后价),fallback 到 lowestCouponPrice / price
  //    list_amount 用原价 price
  const amount =
    g.priceInfo?.lowestPrice ??
    g.priceInfo?.lowestCouponPrice ??
    g.priceInfo?.price ??
    0;
  const listAmount = g.priceInfo?.price ?? amount;

  // 5. 券: 选 isBest=1 那条,没有就第一条
  const bestCoupon =
    g.couponInfo?.couponList?.find((c) => c.isBest === 1) ??
    g.couponInfo?.couponList?.[0];
  const coupon = bestCoupon
    ? {
        // 没有现成 info 文案,由 quota + discount 合成
        info:
          bestCoupon.quota !== undefined && bestCoupon.discount !== undefined
            ? `满 ${bestCoupon.quota} 元减 ${bestCoupon.discount} 元`
            : null,
        discount: bestCoupon.discount ?? null,
        quota: bestCoupon.quota ?? null,
        starts_at: msToDate(bestCoupon.useStartTime),
        ends_at: msToDate(bestCoupon.useEndTime),
      }
    : null;

  // 6. 佣金率: JD 是百分数 (3.0 = 3%),换算成基点 (300 bp) 对齐 alimama
  const commissionRateBp =
    g.commissionInfo?.commissionShare !== undefined
      ? Math.round(g.commissionInfo.commissionShare * 100)
      : null;

  // 7. attributes (自由扩展字段)
  const ownerLabel = pickOwnerLabel(g.owner);
  const attributes: Record<string, unknown> = {
    platform,
    sales_volume_30d: g.inOrderCount30Days ?? null,
    commission_rate_bp: commissionRateBp,
    coupon,
    affiliate_source: 'jdunion',
    ...(ownerLabel ? { jd_owner: ownerLabel } : {}),
    ...(g.shopInfo?.shopName ? { shop_name: g.shopInfo.shopName } : {}),
  };

  // 8. 拼装 CommercialObject
  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.sourceId}_${g.skuId}`,
    object_id: String(g.skuId),
    object_type: 'product',
    provider_id: ctx.sourceId,
    title: g.skuName,
    status: 'active',
    ...(productUrl ? { source_url: productUrl } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: g.skuName,
          ...(g.brandName ? { brand: g.brandName } : {}),
          ...(category ? { category } : {}),
          sku: String(g.skuId),
          ...(productUrl ? { product_url: productUrl } : {}),
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
