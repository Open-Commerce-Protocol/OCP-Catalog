/**
 * Mapper: jd.union.open.promotion.common.get 响应 → AffiliateLink[]
 *
 * 这是 strategy='promotion_common' 的转换路径,与 alimama privilege-to-link 同位。
 *
 * 与 goods-to-link 的差别:
 *   - goods-to-link 输入是 JdPromotionGoodsItem (单 API 同时拿商品 + URL)
 *   - 本文件输入是 promotion.common.get 的 data 字段 (单 API 只拿 URL)
 *
 * 一个 promotion.common.get 调用只产出 1 条 affiliate link;若需券链接,需要再
 * 单独传 couponUrl 入参。所以本 mapper 最多返 1 条。
 */
import type { JdPromotionCommonResult } from '../jd/types';
import { type AffiliateLink } from './goods-to-link';

export function promotionToAffiliateLinks(
  data: JdPromotionCommonResult['data'] | null | undefined,
): AffiliateLink[] {
  if (!data) return [];

  const url =
    (typeof data.shortURL === 'string' && data.shortURL.trim()) ||
    (typeof data.clickURL === 'string' && data.clickURL.trim()) ||
    '';

  if (url.length === 0) return [];

  return [
    {
      link_id: 'buy_now',
      label: '去京东购买',
      url,
      description: 'Open a JD Union PID-attributed purchase URL.',
    },
  ];
}
