/**
 * Mapper: taobao.tbk.privilege.get 响应 → provider-owned affiliate links.
 *
 * 一个商品可能产出多个 affiliate links:
 *   - coupon_click_url      → 'buy_with_coupon'  优先(带 affiliate PID + 券)
 *   - item_url (无券)       → 'buy_now'           带 affiliate PID 但无券
 *   - mm_coupon_click_url   → 'buy_with_tmall_coupon' 天猫专属券(独立 link)
 *
 * 这些链接是 provider API 的内部结果，不是 OCP ActionBinding。动态
 * affiliate action 如何进入 OCP Resolve 应由后续正式协议定义。
 */
import type { AlimamaPrivilegeData } from '../alimama/types';

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

export function privilegeToAffiliateLinks(data: AlimamaPrivilegeData | undefined): AffiliateLink[] {
  if (!data) return [];

  const links: AffiliateLink[] = [];

  // ---- 主推 link:有券走券链接,否则走商品 affiliate 链接 ----
  if (typeof data.coupon_click_url === 'string' && data.coupon_click_url.length > 0) {
    links.push(affiliateLink({
      link_id: 'buy_with_coupon',
      label: data.coupon_info ? `领券购买 (${data.coupon_info})` : '去淘宝购买(含券)',
      url: data.coupon_click_url,
      description: 'Open an Alimama PID-attributed coupon purchase URL.',
    }));
  } else if (typeof data.item_url === 'string' && data.item_url.length > 0) {
    links.push(affiliateLink({
      link_id: 'buy_now',
      label: '去淘宝购买',
      url: data.item_url,
      description: 'Open an Alimama PID-attributed purchase URL.',
    }));
  }

  // ---- 天猫专属券(如果存在且与主券不同)----
  if (
    typeof data.mm_coupon_click_url === 'string' &&
    data.mm_coupon_click_url.length > 0 &&
    data.mm_coupon_click_url !== data.coupon_click_url
  ) {
    links.push(affiliateLink({
      link_id: 'buy_with_tmall_coupon',
      label: data.mm_coupon_info ? `天猫专属券 (${data.mm_coupon_info})` : '天猫专属券购买',
      url: data.mm_coupon_click_url,
      description: 'Open an Alimama PID-attributed Tmall coupon purchase URL.',
    }));
  }

  return links;
}
