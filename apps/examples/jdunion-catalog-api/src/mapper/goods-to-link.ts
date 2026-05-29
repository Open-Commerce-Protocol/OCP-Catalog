/**
 * Mapper: JdPromotionGoodsItem (来自 jd.union.open.goods.promotiongoodsinfo.query) → AffiliateLink[]
 *
 * 这是 default resolve 策略 (JDUNION_RESOLVE_STRATEGY='goods_promotion') 的核心适配。
 *
 * 与 alimama material-to-link 同位:
 *   - alimama 用 material.optional.upgrade 单 API 拿到 affiliate URL
 *   - JD     用 goods.promotiongoodsinfo.query 单 API 拿到 affiliate URL
 *
 * 规则:
 *   - 优先用 shortURL (u.jd.com/xxx),没有就用 clickURL (union-click.jd.com/...)
 *     两者都是带 PID 归因的 affiliate URL,shortURL 用户友好
 *   - couponLink 与主链接不同时,额外输出一个 'buy_with_coupon' link
 *   - item 为 null/undefined 或主链接都缺失 → 返空数组 (resolve 把 link_count=0)
 */
import type { JdPromotionGoodsItem } from '../jd/types';

export interface AffiliateLink {
  link_id: string;
  label: string;
  url: string;
  description?: string;
}

function affiliateLink(input: AffiliateLink): AffiliateLink {
  return {
    link_id: input.link_id,
    label: input.label,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
  };
}

export function goodsToAffiliateLinks(
  item: JdPromotionGoodsItem | null | undefined,
): AffiliateLink[] {
  if (!item) return [];

  const links: AffiliateLink[] = [];
  const primary =
    (typeof item.shortURL === 'string' && item.shortURL.trim()) ||
    (typeof item.clickURL === 'string' && item.clickURL.trim()) ||
    '';

  if (primary.length === 0) return [];

  links.push(
    affiliateLink({
      link_id: 'buy_now',
      label: '去京东购买',
      url: primary,
      description: 'Open a JD Union PID-attributed purchase URL.',
    }),
  );

  if (
    typeof item.couponLink === 'string' &&
    item.couponLink.trim().length > 0 &&
    item.couponLink !== primary
  ) {
    links.push(
      affiliateLink({
        link_id: 'buy_with_coupon',
        label: '领券购买',
        url: item.couponLink,
        description: 'Open a JD Union PID-attributed coupon purchase URL.',
      }),
    );
  }

  return links;
}
