import { describe, expect, test } from 'bun:test';
import type { PddGoodsItem } from '../src/pdd/types';
import {
  absolutize,
  fenToYuan,
  mapGoodsToCommercialObject,
} from '../src/mapper/goods-to-object';

const ctx = { sourceId: 'pdd', catalogBaseUrl: 'http://localhost:4330' };

function makeGoods(overrides: Partial<PddGoodsItem> = {}): PddGoodsItem {
  return {
    goods_id: 250012345678,
    goods_sign: 'ABCDEF_sony_xm5_001',
    goods_name: '索尼(SONY)WH-1000XM5 头戴式无线降噪耳机',
    goods_thumbnail_url: 'https://img.pddpic.com/example/sony-thumb.jpg',
    goods_image_url: 'https://img.pddpic.com/example/sony.jpg',
    min_group_price: 249900,
    min_normal_price: 279900,
    promotion_rate: 50,
    cat_id: 1110,
    cat_name: '耳机/耳麦',
    mall_id: 1,
    mall_name: '索尼旗舰店',
    merchant_type: 3,
    has_coupon: true,
    coupon_discount: 30000,
    coupon_min_order_amount: 280000,
    coupon_start_time: 1716000000,
    coupon_end_time: 1716604800,
    sold_quantity: 125000,
    sales_tip: '12.5万+',
    brand_name: 'SONY',
    ...overrides,
  };
}

describe('absolutize', () => {
  test('// 开头加 https:', () => {
    expect(absolutize('//img.pddpic.com/test.jpg')).toBe('https://img.pddpic.com/test.jpg');
  });
  test('已有 https:// 原样返', () => {
    expect(absolutize('https://img.pddpic.com/a.jpg')).toBe('https://img.pddpic.com/a.jpg');
  });
  test('空 / undefined / null 返 undefined', () => {
    expect(absolutize('')).toBeUndefined();
    expect(absolutize(undefined)).toBeUndefined();
    expect(absolutize(null)).toBeUndefined();
    expect(absolutize('   ')).toBeUndefined();
  });
});

describe('fenToYuan', () => {
  test('249900 → 2499', () => {
    expect(fenToYuan(249900)).toBe(2499);
  });
  test('1990 → 19.9', () => {
    expect(fenToYuan(1990)).toBe(19.9);
  });
  test('null / undefined / NaN → 0', () => {
    expect(fenToYuan(null)).toBe(0);
    expect(fenToYuan(undefined)).toBe(0);
    expect(fenToYuan(NaN)).toBe(0);
  });
});

describe('mapGoodsToCommercialObject', () => {
  test('基本结构: 3 descriptor pack, status active, object_id == goods_id', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    expect(obj.kind).toBe('CommercialObject');
    expect(obj.object_type).toBe('product');
    expect(obj.status).toBe('active');
    expect(obj.provider_id).toBe('pdd');
    expect(obj.id).toBe('obj_pdd_250012345678');
    expect(obj.object_id).toBe('250012345678');
    expect(obj.descriptors.map((d) => d.pack_id).sort()).toEqual([
      'ocp.commerce.inventory.v1',
      'ocp.commerce.price.v1',
      'ocp.commerce.product.core.v1',
    ]);
  });

  test('PDD 价格分单位换算为元 number', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data;
    expect(price.amount).toBe(2499);            // 249900 fen → 2499 yuan
    expect(price.list_amount).toBe(2799);       // 279900 fen → 2799 yuan
    expect(typeof price.amount).toBe('number');
    expect(price.currency).toBe('CNY');
  });

  test('小价格商品也能正确换算 (1990 fen → 19.9)', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({ min_group_price: 1990, min_normal_price: 2790 }),
      ctx,
    );
    const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data;
    expect(price.amount).toBe(19.9);
    expect(price.list_amount).toBe(27.9);
  });

  test('image_urls 全部 https + dedupe', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({
        goods_image_url: 'https://img.pddpic.com/main.jpg',
        goods_thumbnail_url: 'https://img.pddpic.com/main.jpg', // 故意重复
        goods_gallery_urls: ['https://img.pddpic.com/gallery1.jpg'],
      }),
      ctx,
    );
    const urls = (obj.descriptors[0]!.data.image_urls as string[]) ?? [];
    expect(urls.length).toBe(2);
    expect(urls.every((u) => u.startsWith('https://'))).toBe(true);
  });

  test('// 开头的图也能 absolutize (防御性)', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({ goods_image_url: '//img.pddpic.com/x.jpg', goods_thumbnail_url: undefined }),
      ctx,
    );
    const urls = (obj.descriptors[0]!.data.image_urls as string[]) ?? [];
    expect(urls[0]).toBe('https://img.pddpic.com/x.jpg');
  });

  test('commission_rate_bp = promotion_rate × 10 (50 千分位 → 500 bp)', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ promotion_rate: 50 }), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.commission_rate_bp).toBe(500);
  });

  test('promotion_rate 120 (12%) → 1200 bp', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ promotion_rate: 120 }), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.commission_rate_bp).toBe(1200);
  });

  test('无 promotion_rate → commission_rate_bp = null', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ promotion_rate: undefined }), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.commission_rate_bp).toBeNull();
  });

  test('platform=pdd, affiliate_source=pdd_duoduojinbao', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.platform).toBe('pdd');
    expect(attrs.affiliate_source).toBe('pdd_duoduojinbao');
  });

  test('merchant_type 1/2/3/4/5 → personal/enterprise/flagship/exclusive/specialty', () => {
    const types: Array<[number, string]> = [
      [1, 'personal'],
      [2, 'enterprise'],
      [3, 'flagship'],
      [4, 'exclusive'],
      [5, 'specialty'],
    ];
    for (const [code, label] of types) {
      const obj = mapGoodsToCommercialObject(makeGoods({ merchant_type: code }), ctx);
      const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
      expect(attrs.pdd_merchant_type).toBe(label);
    }
  });

  test('未知 merchant_type → 不输出 pdd_merchant_type', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ merchant_type: 99 }), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.pdd_merchant_type).toBeUndefined();
  });

  test('类目: cat_name 优先 → category_name → cat_id 数字', () => {
    const a = mapGoodsToCommercialObject(makeGoods({ cat_name: '耳机/耳麦' }), ctx);
    expect(a.descriptors[0]!.data.category).toBe('耳机/耳麦');

    const b = mapGoodsToCommercialObject(
      makeGoods({ cat_name: undefined, category_name: '电脑配件' }),
      ctx,
    );
    expect(b.descriptors[0]!.data.category).toBe('电脑配件');

    const c = mapGoodsToCommercialObject(
      makeGoods({ cat_name: undefined, category_name: undefined, cat_id: 5266 }),
      ctx,
    );
    expect(c.descriptors[0]!.data.category).toBe('5266');
  });

  test('券存在: attributes.coupon 是对象,金额换成元', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({
        has_coupon: true,
        coupon_discount: 30000,
        coupon_min_order_amount: 280000,
      }),
      ctx,
    );
    const c = (obj.descriptors[0]!.data.attributes as any).coupon;
    expect(c).not.toBeNull();
    expect(c.discount_yuan).toBe(300);          // 30000 fen → 300 yuan
    expect(c.quota_yuan).toBe(2800);            // 280000 fen → 2800 yuan
    expect(c.info).toContain('满 2800 元减 300 元');
  });

  test('has_coupon=false → coupon 是 null', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ has_coupon: false }), ctx);
    const c = (obj.descriptors[0]!.data.attributes as any).coupon;
    expect(c).toBeNull();
  });

  test('source_url 是从 goods_id 拼成的 yangkeduo.com URL', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ goods_id: 9999 }), ctx);
    expect(obj.source_url).toBe('https://mobile.yangkeduo.com/goods.html?goods_id=9999');
    expect(obj.descriptors[0]!.data.product_url).toBe(
      'https://mobile.yangkeduo.com/goods.html?goods_id=9999',
    );
  });

  test('goods_sign 写入 attributes (新版 API 推荐用 goods_sign 做单品引用)', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({ goods_sign: 'XXX_special_sign' }),
      ctx,
    );
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.goods_sign).toBe('XXX_special_sign');
  });
});
