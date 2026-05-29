import { describe, expect, test } from 'bun:test';
import type { PddPromotionUrlItem } from '../src/pdd/types';
import { promotionUrlToAffiliateLinks } from '../src/mapper/url-to-link';

function makeItem(overrides: Partial<PddPromotionUrlItem> = {}): PddPromotionUrlItem {
  return {
    url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123',
    short_url: 'https://p.pinduoduo.com/abc',
    mobile_short_url: 'https://p.pinduoduo.com/mobile_abc',
    we_app_web_view_short_url: 'https://mobile.yangkeduo.com/we_app/abc',
    qq_app_web_view_short_url: 'https://mobile.yangkeduo.com/qq_app/abc',
    ...overrides,
  };
}

describe('promotionUrlToAffiliateLinks', () => {
  test('完整字段时返 3 条 link (buy_now + wechat + qq)', () => {
    const links = promotionUrlToAffiliateLinks(makeItem());
    expect(links.length).toBe(3);
    expect(links[0]!.link_id).toBe('buy_now');
    expect(links[0]!.url).toContain('p.pinduoduo.com');
    expect(links[1]!.link_id).toBe('buy_in_wechat');
    expect(links[2]!.link_id).toBe('buy_in_qq');
  });

  test('只有 short_url → 单条 buy_now', () => {
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        we_app_web_view_short_url: undefined,
        qq_app_web_view_short_url: undefined,
      }),
    );
    expect(links.length).toBe(1);
    expect(links[0]!.link_id).toBe('buy_now');
  });

  test('short_url 缺失 → fallback 到 mobile_short_url', () => {
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        short_url: undefined,
        we_app_web_view_short_url: undefined,
        qq_app_web_view_short_url: undefined,
      }),
    );
    expect(links.length).toBe(1);
    expect(links[0]!.url).toContain('mobile_abc');
  });

  test('short_url 与 mobile_short_url 都缺失 → fallback 到 url', () => {
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        short_url: undefined,
        mobile_short_url: undefined,
        we_app_web_view_short_url: undefined,
        qq_app_web_view_short_url: undefined,
      }),
    );
    expect(links.length).toBe(1);
    expect(links[0]!.url).toContain('mobile.yangkeduo.com');
  });

  test('全部 URL 字段缺失 → 返空数组', () => {
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        url: undefined,
        short_url: undefined,
        mobile_short_url: undefined,
        we_app_web_view_short_url: undefined,
        qq_app_web_view_short_url: undefined,
      }),
    );
    expect(links).toEqual([]);
  });

  test('空字符串 / 空白等同缺失', () => {
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        url: '',
        short_url: '   ',
        mobile_short_url: '',
        we_app_web_view_short_url: '',
        qq_app_web_view_short_url: '',
      }),
    );
    expect(links).toEqual([]);
  });

  test('we_app 与主链相同时不重复输出', () => {
    const same = 'https://p.pinduoduo.com/same';
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        short_url: same,
        we_app_web_view_short_url: same,
        qq_app_web_view_short_url: undefined,
      }),
    );
    expect(links.length).toBe(1);
    expect(links[0]!.link_id).toBe('buy_now');
  });

  test('qq_app 与 we_app 相同时只输出一份', () => {
    const weAndQq = 'https://shared.example.com/x';
    const links = promotionUrlToAffiliateLinks(
      makeItem({
        we_app_web_view_short_url: weAndQq,
        qq_app_web_view_short_url: weAndQq,
      }),
    );
    expect(links.length).toBe(2); // buy_now + wechat
    expect(links.find((l) => l.link_id === 'buy_in_qq')).toBeUndefined();
  });

  test('null / undefined 输入 → 返空数组', () => {
    expect(promotionUrlToAffiliateLinks(null)).toEqual([]);
    expect(promotionUrlToAffiliateLinks(undefined)).toEqual([]);
  });

  test('description 包含 PDD Duoduojinbao 标识', () => {
    const links = promotionUrlToAffiliateLinks(makeItem());
    expect(links[0]!.description).toContain('PDD');
  });
});
