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
 *   - item.item_url 为空 → 返 [] (resolve 会把 link_count 设为 0、live_check 设为 'unknown')
 *   - item.coupon_info 存在 → 1 个 'buy_with_coupon' link (label 带券描述)
 *   - 否则 → 1 个 'buy_now' link
 *
 * 未来想增强 (返多 link)：
 *   - upgrade 响应里 publish_info.coupon_share_url 与 click_url 不同时,可再加一个 'buy_with_coupon'
 *     这需要 normalize 时保留两个 URL —— 当前 normalize 把它们合成了一个 item_url
 *     如要支持,可让 normalize 在 small_images 上"挤"一格,或者再加一个 affiliate_urls 字段
 *
 * @param item  AlimamaMaterialItem;为 null/undefined 返空数组
 */
export function materialToAffiliateLinks(
  item: AlimamaMaterialItem | null | undefined,
): AffiliateLink[] {
  if (!item) return [];

  const url = typeof item.item_url === 'string' ? item.item_url.trim() : '';
  if (url.length === 0) return [];

  if (item.coupon_info) {
    return [
      {
        link_id: 'buy_with_coupon',
        label: `领券购买 (${item.coupon_info})`,
        url,
        description: 'Open an Alimama PID-attributed coupon purchase URL.',
      },
    ];
  }

  return [
    {
      link_id: 'buy_now',
      label: '去淘宝购买',
      url,
      description: 'Open an Alimama PID-attributed purchase URL.',
    },
  ];
}
