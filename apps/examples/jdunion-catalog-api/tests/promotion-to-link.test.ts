import { describe, expect, test } from 'bun:test';
import { promotionToAffiliateLinks } from '../src/mapper/promotion-to-link';

describe('promotionToAffiliateLinks', () => {
  test('shortURL 存在 → buy_now', () => {
    const links = promotionToAffiliateLinks({
      shortURL: 'https://u.jd.com/xyz',
      clickURL: 'https://union-click.jd.com/jdc?long',
    });
    expect(links.length).toBe(1);
    expect(links[0]!.link_id).toBe('buy_now');
    expect(links[0]!.url).toBe('https://u.jd.com/xyz');
  });

  test('只有 clickURL → 用 clickURL', () => {
    const links = promotionToAffiliateLinks({
      clickURL: 'https://union-click.jd.com/jdc?long',
    });
    expect(links.length).toBe(1);
    expect(links[0]!.url).toContain('union-click.jd.com');
  });

  test('shortURL 空串 → fallback 到 clickURL', () => {
    const links = promotionToAffiliateLinks({
      shortURL: '',
      clickURL: 'https://union-click.jd.com/jdc?fallback',
    });
    expect(links.length).toBe(1);
    expect(links[0]!.url).toContain('union-click.jd.com');
  });

  test('两者都空 → 返空数组', () => {
    expect(promotionToAffiliateLinks({})).toEqual([]);
    expect(promotionToAffiliateLinks({ shortURL: '', clickURL: '' })).toEqual([]);
  });

  test('null / undefined → 返空数组', () => {
    expect(promotionToAffiliateLinks(null)).toEqual([]);
    expect(promotionToAffiliateLinks(undefined)).toEqual([]);
  });

  test('description 永远有,可识别为 JD Union 链接', () => {
    const links = promotionToAffiliateLinks({ shortURL: 'https://u.jd.com/abc' });
    expect(links[0]!.description).toContain('JD Union');
  });
});
