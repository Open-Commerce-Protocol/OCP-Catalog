import { describe, expect, test } from 'bun:test';
import type { AlimamaMaterialItem } from '../src/alimama/types';
import { materialToAffiliateLinks } from '../src/mapper/material-to-link';

const baseItem: AlimamaMaterialItem = {
  num_iid: '700123456001',
  title: 'Test item',
  pict_url: 'https://img.example/item.jpg',
  item_url: 'https://s.click.taobao.com/click',
  reserve_price: '100.00',
  zk_final_price: '80.00',
  user_type: 1,
};

describe('materialToAffiliateLinks', () => {
  test('coupon_share_url 优先生成领券购买 action', () => {
    const links = materialToAffiliateLinks({
      ...baseItem,
      coupon_info: '满 100 减 20',
      affiliate_urls: {
        click_url: 'https://s.click.taobao.com/click',
        coupon_share_url: 'https://uland.taobao.com/coupon',
      },
    });

    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      link_id: 'buy_with_coupon',
      url: 'https://uland.taobao.com/coupon',
    });
    expect(links[1]).toMatchObject({
      link_id: 'buy_now',
      url: 'https://s.click.taobao.com/click',
    });
  });

  test('没有 coupon_share_url 时不会把 click_url 标成领券链接', () => {
    const links = materialToAffiliateLinks({
      ...baseItem,
      coupon_info: '满 100 减 20',
      affiliate_urls: {
        click_url: 'https://s.click.taobao.com/click',
      },
    });

    expect(links).toEqual([
      {
        link_id: 'buy_now',
        label: '去淘宝购买',
        url: 'https://s.click.taobao.com/click',
        description: 'Open an Alimama PID-attributed purchase URL.',
      },
    ]);
  });

  test('无任何可用推广 URL 时返回空数组', () => {
    expect(materialToAffiliateLinks({
      ...baseItem,
      item_url: '',
      affiliate_urls: {},
    })).toEqual([]);
  });
});
