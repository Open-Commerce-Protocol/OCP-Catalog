import { describe, expect, test } from 'bun:test';
import type { JdPromotionGoodsItem } from '../src/jd/types';
import { goodsToAffiliateLinks } from '../src/mapper/goods-to-link';

function makeItem(overrides: Partial<JdPromotionGoodsItem> = {}): JdPromotionGoodsItem {
  return {
    skuId: 100012345678,
    goodsName: '索尼耳机',
    unitPrice: 2799,
    unitPriceLow: 2499,
    shortURL: 'https://u.jd.com/abc123',
    clickURL: 'https://union-click.jd.com/jdc?e=&p=longform',
    ...overrides,
  };
}

describe('goodsToAffiliateLinks', () => {
  test('shortURL 存在 → 1 个 buy_now link 用 shortURL', () => {
    const links = goodsToAffiliateLinks(makeItem());
    expect(links.length).toBe(1);
    expect(links[0]!.link_id).toBe('buy_now');
    expect(links[0]!.url).toBe('https://u.jd.com/abc123');
  });

  test('shortURL 缺失 → fallback 用 clickURL', () => {
    const links = goodsToAffiliateLinks(makeItem({ shortURL: undefined }));
    expect(links.length).toBe(1);
    expect(links[0]!.url).toContain('union-click.jd.com');
  });

  test('两者都缺失 → 返空数组', () => {
    const links = goodsToAffiliateLinks(
      makeItem({ shortURL: undefined, clickURL: undefined }),
    );
    expect(links).toEqual([]);
  });

  test('shortURL 是空串/纯空白 → 视同缺失', () => {
    const links1 = goodsToAffiliateLinks(makeItem({ shortURL: '', clickURL: undefined }));
    expect(links1).toEqual([]);
    const links2 = goodsToAffiliateLinks(
      makeItem({ shortURL: '   ', clickURL: undefined }),
    );
    expect(links2).toEqual([]);
  });

  test('couponLink 与主链接不同 → 加 buy_with_coupon', () => {
    const links = goodsToAffiliateLinks(
      makeItem({ couponLink: 'https://coupon.m.jd.com/affiliate?key=x' }),
    );
    expect(links.length).toBe(2);
    expect(links[1]!.link_id).toBe('buy_with_coupon');
    expect(links[1]!.url).toBe('https://coupon.m.jd.com/affiliate?key=x');
  });

  test('couponLink 与主链接相同 → 不重复加', () => {
    const same = 'https://u.jd.com/abc123';
    const links = goodsToAffiliateLinks(makeItem({ couponLink: same }));
    expect(links.length).toBe(1);
    expect(links[0]!.link_id).toBe('buy_now');
  });

  test('null / undefined 输入 → 返空数组', () => {
    expect(goodsToAffiliateLinks(null)).toEqual([]);
    expect(goodsToAffiliateLinks(undefined)).toEqual([]);
  });
});
