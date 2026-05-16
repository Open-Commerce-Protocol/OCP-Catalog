/**
 * Mapper: taobao.tbk.privilege.get 响应 → OCP ActionBinding[]
 *
 * 一个商品可能产出多个 ActionBinding:
 *   - coupon_click_url      → 'buy_with_coupon'  优先(带 affiliate PID + 券)
 *   - item_url (无券)       → 'buy_now'           带 affiliate PID 但无券
 *   - mm_coupon_click_url   → 'buy_with_tmall_coupon' 天猫专属券(独立 binding)
 *
 * 都是 action_type: 'url' + method: 'GET',符合 OCP actionBindingSchema 当前的限制
 * (action_type 只能是 'url' / method 只能是 'GET')。
 *
 * 注意:Catalog 自带的 commerce-scenario 会自动加一个无 PID 的 view_product binding,
 * 我们这边产出的全部带 PID。Agent 最终看到的 action_bindings 是合并后的结果。
 */
import type { AlimamaPrivilegeData } from '../alimama/types';

export interface ActionBinding {
  action_id: string;
  action_type: 'url';
  label: string;
  url: string;
  method: 'GET';
}

export function privilegeToActionBindings(data: AlimamaPrivilegeData | undefined): ActionBinding[] {
  if (!data) return [];

  const bindings: ActionBinding[] = [];

  // ---- 主推 binding:有券走券链接,否则走商品 affiliate 链接 ----
  if (typeof data.coupon_click_url === 'string' && data.coupon_click_url.length > 0) {
    bindings.push({
      action_id: 'buy_with_coupon',
      action_type: 'url',
      label: data.coupon_info ? `领券购买 (${data.coupon_info})` : '去淘宝购买(含券)',
      url: data.coupon_click_url,
      method: 'GET',
    });
  } else if (typeof data.item_url === 'string' && data.item_url.length > 0) {
    bindings.push({
      action_id: 'buy_now',
      action_type: 'url',
      label: '去淘宝购买',
      url: data.item_url,
      method: 'GET',
    });
  }

  // ---- 天猫专属券(如果存在且与主券不同)----
  if (
    typeof data.mm_coupon_click_url === 'string' &&
    data.mm_coupon_click_url.length > 0 &&
    data.mm_coupon_click_url !== data.coupon_click_url
  ) {
    bindings.push({
      action_id: 'buy_with_tmall_coupon',
      action_type: 'url',
      label: data.mm_coupon_info ? `天猫专属券 (${data.mm_coupon_info})` : '天猫专属券购买',
      url: data.mm_coupon_click_url,
      method: 'GET',
    });
  }

  return bindings;
}
