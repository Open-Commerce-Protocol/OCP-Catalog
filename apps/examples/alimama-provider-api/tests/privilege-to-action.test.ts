import { describe, expect, test } from 'bun:test';
import { privilegeToActionBindings } from '../src/mapper/privilege-to-action';
import type { AlimamaPrivilegeData } from '../src/alimama/types';

describe('privilegeToActionBindings', () => {
  test('有 coupon_click_url + coupon_info → 主推 buy_with_coupon, 含券描述', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/abc',
      coupon_info: '满 99 减 10',
    };
    const bindings = privilegeToActionBindings(data);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({
      action_id: 'buy_with_coupon',
      action_type: 'url',
      label: '领券购买 (满 99 减 10)',
      url: 'https://s.click.taobao.com/abc',
      method: 'GET',
    });
  });

  test('有 coupon_click_url 但无 coupon_info → 标签兜底', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/abc',
    };
    const bindings = privilegeToActionBindings(data);
    expect(bindings[0]!.label).toBe('去淘宝购买(含券)');
  });

  test('无 coupon_click_url, 但有 item_url → buy_now', () => {
    const data: AlimamaPrivilegeData = {
      item_url: 'https://s.click.taobao.com/xyz',
    };
    const bindings = privilegeToActionBindings(data);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.action_id).toBe('buy_now');
    expect(bindings[0]!.url).toBe('https://s.click.taobao.com/xyz');
  });

  test('mm_coupon_click_url 存在且与主券不同 → 加 tmall 专属 binding', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/main',
      mm_coupon_click_url: 'https://s.click.taobao.com/tmall',
      mm_coupon_info: '天猫满 199 减 30',
    };
    const bindings = privilegeToActionBindings(data);
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.action_id).toBe('buy_with_coupon');
    expect(bindings[1]!.action_id).toBe('buy_with_tmall_coupon');
    expect(bindings[1]!.label).toBe('天猫专属券 (天猫满 199 减 30)');
  });

  test('mm_coupon_click_url 与主券相同 → 不重复', () => {
    const sameUrl = 'https://s.click.taobao.com/x';
    const data: AlimamaPrivilegeData = {
      coupon_click_url: sameUrl,
      mm_coupon_click_url: sameUrl,
    };
    const bindings = privilegeToActionBindings(data);
    expect(bindings).toHaveLength(1);
  });

  test('完全空 data → 空数组', () => {
    expect(privilegeToActionBindings({})).toEqual([]);
    expect(privilegeToActionBindings(undefined)).toEqual([]);
  });

  test('所有 binding 都符合 OCP actionBindingSchema 约束', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/a',
      mm_coupon_click_url: 'https://s.click.taobao.com/b',
    };
    const bindings = privilegeToActionBindings(data);
    for (const b of bindings) {
      expect(b.action_type).toBe('url');
      expect(b.method).toBe('GET');
      expect(b.url).toMatch(/^https:\/\//);
      expect(b.action_id).toBeTruthy();
      expect(b.label).toBeTruthy();
    }
  });

  test('使用真实 fixture 数据', async () => {
    const fixture = await import('./fixtures/privilege-get-sample.json');
    const data = fixture.default.tbk_privilege_get_response.result.data;
    const bindings = privilegeToActionBindings(data);
    // fixture 同时有 coupon_click_url 和 mm_coupon_click_url(不同) → 2 个 binding
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.action_id).toBe('buy_with_coupon');
    expect(bindings[1]!.action_id).toBe('buy_with_tmall_coupon');
  });
});
