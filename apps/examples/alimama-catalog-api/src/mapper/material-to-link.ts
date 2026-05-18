/**
 * Mapper: AlimamaMaterialItem (来自 material.optional.upgrade 归一化后) → AffiliateLink[]
 *
 * 这是修复 Day 7 resolve session 错误的核心适配。
 *
 * 背景：
 *   原 resolve 实现走 taobao.tbk.privilege.get,该 API 要 TOP session,
 *   在无用户 OAuth 授权的场景下报 "传入http参数中必需包含session字段"。
 *
 * 新 resolve 实现走 taobao.tbk.dg.material.optional.upgrade + item_id_list,
 *   该 API 不需要 session,且 publish_info.click_url 已经是带 PID 的 affiliate URL。
 *   normalizeMaterialOptionalUpgrade() 已把这个 URL 写进了 AlimamaMaterialItem.item_url。
 *
 * 这个 mapper 负责把单个归一化后的 item 转成 OCP catalog 用的 AffiliateLink 列表,
 *   语义与 privilegeToAffiliateLinks 对齐。
 */
import type { AlimamaMaterialItem } from '../alimama/types';
import type { AffiliateLink } from './privilege-to-link';

/**
 * 把单个商品转成 1 个或 0 个 AffiliateLink。
 *
 * 当前规则：
 *   - 没有任何可用推广 URL → 返 []
 *   - coupon_share_url 存在 → 'buy_with_coupon'
 *   - click_url/item_url 存在 → 'buy_now'
 *   - 两个 URL 都存在且不同 → 返回两个 action
 *
 * @param item  AlimamaMaterialItem;为 null/undefined 返空数组
 */
export function materialToAffiliateLinks(
  item: AlimamaMaterialItem | null | undefined,
): AffiliateLink[] {
  if (!item) return [];

  const clickUrl = cleanUrl(item.affiliate_urls?.click_url) ?? cleanUrl(item.item_url);
  const couponUrl = cleanUrl(item.affiliate_urls?.coupon_share_url);
  const links: AffiliateLink[] = [];

  if (item.coupon_info && couponUrl) {
    links.push({
      link_id: 'buy_with_coupon',
      label: `领券购买 (${item.coupon_info})`,
      url: couponUrl,
      description: 'Open an Alimama PID-attributed coupon purchase URL.',
    });
  }

  if (clickUrl && clickUrl !== couponUrl) {
    links.push({
      link_id: 'buy_now',
      label: '去淘宝购买',
      url: clickUrl,
      description: 'Open an Alimama PID-attributed purchase URL.',
    });
  }

  if (links.length === 0 && couponUrl) {
    links.push({
      link_id: 'buy_with_coupon',
      label: item.coupon_info ? `领券购买 (${item.coupon_info})` : '去淘宝购买(含券)',
      url: couponUrl,
      description: 'Open an Alimama PID-attributed coupon purchase URL.',
    });
  }

  return links;
}

function cleanUrl(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
}
