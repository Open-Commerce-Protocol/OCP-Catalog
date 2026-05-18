import { describe, expect, test } from 'bun:test';
import { privilegeToAffiliateLinks } from '../src/mapper/privilege-to-link';
import type { AlimamaPrivilegeData } from '../src/alimama/types';

describe('privilegeToAffiliateLinks', () => {
  test('有 coupon_click_url + coupon_info → 主推 buy_with_coupon, 含券描述', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/abc',
      coupon_info: '满 99 减 10',
    };
    const links = privilegeToAffiliateLinks(data);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      link_id: 'buy_with_coupon',
      label: '领券购买 (满 99 减 10)',
      url: 'https://s.click.taobao.com/abc',
      description: 'Open an Alimama PID-attributed coupon purchase URL.',
    });
  });

  test('有 coupon_click_url 但无 coupon_info → 标签兜底', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/abc',
    };
    const links = privilegeToAffiliateLinks(data);
    expect(links[0]!.label).toBe('去淘宝购买(含券)');
  });

  test('无 coupon_click_url, 但有 item_url → buy_now', () => {
    const data: AlimamaPrivilegeData = {
      item_url: 'https://s.click.taobao.com/xyz',
    };
    const links = privilegeToAffiliateLinks(data);
    expect(links).toHaveLength(1);
    expect(links[0]!.link_id).toBe('buy_now');
    expect(links[0]!.url).toBe('https://s.click.taobao.com/xyz');
  });

  test('mm_coupon_click_url 存在且与主券不同 → 加 tmall 专属 link', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/main',
      mm_coupon_click_url: 'https://s.click.taobao.com/tmall',
      mm_coupon_info: '天猫满 199 减 30',
    };
    const links = privilegeToAffiliateLinks(data);
    expect(links).toHaveLength(2);
    expect(links[0]!.link_id).toBe('buy_with_coupon');
    expect(links[1]!.link_id).toBe('buy_with_tmall_coupon');
    expect(links[1]!.label).toBe('天猫专属券 (天猫满 199 减 30)');
  });

  test('mm_coupon_click_url 与主券相同 → 不重复', () => {
    const sameUrl = 'https://s.click.taobao.com/x';
    const data: AlimamaPrivilegeData = {
      coupon_click_url: sameUrl,
      mm_coupon_click_url: sameUrl,
    };
    const links = privilegeToAffiliateLinks(data);
    expect(links).toHaveLength(1);
  });

  test('完全空 data → 空数组', () => {
    expect(privilegeToAffiliateLinks({})).toEqual([]);
    expect(privilegeToAffiliateLinks(undefined)).toEqual([]);
  });

  test('所有 link 都是 affiliate URL 结果，不暴露 OCP ActionBinding 字段', () => {
    const data: AlimamaPrivilegeData = {
      coupon_click_url: 'https://s.click.taobao.com/a',
      mm_coupon_click_url: 'https://s.click.taobao.com/b',
    };
    const links = privilegeToAffiliateLinks(data);
    for (const link of links) {
      expect(link.url).toMatch(/^https:\/\//);
      expect(link.link_id).toBeTruthy();
      expect(link.label).toBeTruthy();
      expect((link as any).action_type).toBeUndefined();
      expect((link as any).entrypoint).toBeUndefined();
    }
  });

  test('使用真实 fixture 数据', async () => {
    const fixture = await import('./fixtures/privilege-get-sample.json');
    const data = fixture.default.tbk_privilege_get_response.result.data;
    const links = privilegeToAffiliateLinks(data);
    // fixture 同时有 coupon_click_url 和 mm_coupon_click_url(不同) → 2 个 link
    expect(links).toHaveLength(2);
    expect(links[0]!.link_id).toBe('buy_with_coupon');
    expect(links[1]!.link_id).toBe('buy_with_tmall_coupon');
  });
});
