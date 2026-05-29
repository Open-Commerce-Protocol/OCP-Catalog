import { describe, expect, test } from 'bun:test';
import type { JdGoodsItem } from '../src/jd/types';
import {
  absolutize,
  mapGoodsToCommercialObject,
} from '../src/mapper/goods-to-object';

const ctx = { sourceId: 'jdunion', catalogBaseUrl: 'http://localhost:4320' };

function makeGoods(overrides: Partial<JdGoodsItem> = {}): JdGoodsItem {
  return {
    skuId: 100012345678,
    skuName: '索尼(SONY)WH-1000XM5 头戴式无线降噪耳机',
    imageInfo: {
      imageList: [{ url: '//img14.360buyimg.com/n0/jfs/t1/example/sony-1.jpg' }],
    },
    priceInfo: { price: 2799.0, lowestPrice: 2499.0 },
    commissionInfo: { commissionShare: 3.0, commission: 74.97 },
    shopInfo: { shopId: 1, shopName: '索尼京东自营官方旗舰店' },
    categoryInfo: {
      cid1: 670,
      cid2: 677,
      cid3: 1110,
      cid1Name: '电脑、办公',
      cid2Name: '外设产品',
      cid3Name: '耳机/耳麦',
    },
    materialUrl: 'https://item.jd.com/100012345678.html',
    inOrderCount30Days: 12500,
    owner: 'g',
    brandName: 'SONY',
    ...overrides,
  };
}

describe('absolutize', () => {
  test('// 开头加 https:', () => {
    expect(absolutize('//img14.360buyimg.com/test.jpg')).toBe(
      'https://img14.360buyimg.com/test.jpg',
    );
  });

  test('已有 https:// 原样返', () => {
    expect(absolutize('https://item.jd.com/1.html')).toBe('https://item.jd.com/1.html');
  });

  test('已有 http:// 原样返', () => {
    expect(absolutize('http://example.com')).toBe('http://example.com');
  });

  test('裸域名兜底加 https://', () => {
    expect(absolutize('img.example.com/a.jpg')).toBe('https://img.example.com/a.jpg');
  });

  test('空 / undefined / null 返 undefined', () => {
    expect(absolutize('')).toBeUndefined();
    expect(absolutize(undefined)).toBeUndefined();
    expect(absolutize(null)).toBeUndefined();
    expect(absolutize('   ')).toBeUndefined();
  });
});

describe('mapGoodsToCommercialObject', () => {
  test('基本结构: 3 descriptor pack, status active, object_id == skuId', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    expect(obj.kind).toBe('CommercialObject');
    expect(obj.object_type).toBe('product');
    expect(obj.status).toBe('active');
    expect(obj.provider_id).toBe('jdunion');
    expect(obj.id).toBe('obj_jdunion_100012345678');
    expect(obj.object_id).toBe('100012345678');
    expect(obj.descriptors.map((d) => d.pack_id).sort()).toEqual([
      'ocp.commerce.inventory.v1',
      'ocp.commerce.price.v1',
      'ocp.commerce.product.core.v1',
    ]);
  });

  test('所有 image_urls 都是绝对 https:// URL', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({
        imageInfo: {
          imageList: [
            { url: '//img14.360buyimg.com/n0/a.jpg' },
            { url: '//img14.360buyimg.com/n0/b.jpg' },
          ],
          whiteImage: '//img14.360buyimg.com/n0/white.jpg',
        },
      }),
      ctx,
    );
    const core = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1')!;
    const urls = (core.data.image_urls as string[]) ?? [];
    expect(urls.length).toBe(3);
    expect(urls.every((u) => u.startsWith('https://'))).toBe(true);
  });

  test('image_urls 去重(imageList 与 whiteImage 完全相同时只保留一份)', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({
        imageInfo: {
          imageList: [{ url: '//img.jd/a.jpg' }],
          whiteImage: '//img.jd/a.jpg',
        },
      }),
      ctx,
    );
    const urls = (obj.descriptors[0]!.data.image_urls as string[]) ?? [];
    expect(urls.length).toBe(1);
  });

  test('price.v1 是 number 而非 string', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data;
    expect(typeof price.amount).toBe('number');
    expect(typeof price.list_amount).toBe('number');
    expect(price.amount).toBe(2499);
    expect(price.list_amount).toBe(2799);
    expect(price.currency).toBe('CNY');
  });

  test('amount 优先用 lowestPrice; lowestPrice 缺失时 fallback 到 lowestCouponPrice → price', () => {
    const fallback1 = mapGoodsToCommercialObject(
      makeGoods({ priceInfo: { price: 200, lowestCouponPrice: 150 } }),
      ctx,
    );
    expect(
      fallback1.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data.amount,
    ).toBe(150);

    const fallback2 = mapGoodsToCommercialObject(
      makeGoods({ priceInfo: { price: 200 } }),
      ctx,
    );
    expect(
      fallback2.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data.amount,
    ).toBe(200);
  });

  test('commission_rate_bp 由 commissionShare ×100 得来 (3.0% → 300 bp)', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({ commissionInfo: { commissionShare: 3.0 } }),
      ctx,
    );
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.commission_rate_bp).toBe(300);
  });

  test('无 commissionInfo → commission_rate_bp = null', () => {
    const obj = mapGoodsToCommercialObject(makeGoods({ commissionInfo: undefined }), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.commission_rate_bp).toBeNull();
  });

  test('platform 标记 == "jd",affiliate_source == "jdunion"', () => {
    const obj = mapGoodsToCommercialObject(makeGoods(), ctx);
    const attrs = (obj.descriptors[0]!.data.attributes as Record<string, unknown>) ?? {};
    expect(attrs.platform).toBe('jd');
    expect(attrs.affiliate_source).toBe('jdunion');
  });

  test('owner=g → jd_owner=self_operated;owner=p → jd_owner=pop', () => {
    const self = mapGoodsToCommercialObject(makeGoods({ owner: 'g' }), ctx);
    const pop = mapGoodsToCommercialObject(makeGoods({ owner: 'p' }), ctx);
    const none = mapGoodsToCommercialObject(makeGoods({ owner: undefined }), ctx);
    expect((self.descriptors[0]!.data.attributes as any).jd_owner).toBe('self_operated');
    expect((pop.descriptors[0]!.data.attributes as any).jd_owner).toBe('pop');
    expect((none.descriptors[0]!.data.attributes as any).jd_owner).toBeUndefined();
  });

  test('类目: cid3Name 最具体优先,缺时 fallback', () => {
    const a = mapGoodsToCommercialObject(makeGoods(), ctx);
    expect(a.descriptors[0]!.data.category).toBe('耳机/耳麦');

    const b = mapGoodsToCommercialObject(
      makeGoods({ categoryInfo: { cid2Name: '外设产品' } }),
      ctx,
    );
    expect(b.descriptors[0]!.data.category).toBe('外设产品');

    const c = mapGoodsToCommercialObject(
      makeGoods({ categoryInfo: { cid3: 1110 } }),
      ctx,
    );
    expect(c.descriptors[0]!.data.category).toBe('1110');
  });

  test('券存在: attributes.coupon 是对象;不存在: 是 null', () => {
    const withCoupon = mapGoodsToCommercialObject(
      makeGoods({
        couponInfo: {
          couponList: [{ discount: 300, quota: 2800, isBest: 1 }],
        },
      }),
      ctx,
    );
    const c1 = (withCoupon.descriptors[0]!.data.attributes as any).coupon;
    expect(c1).not.toBeNull();
    expect(c1.info).toContain('满 2800 元减 300 元');
    expect(c1.discount).toBe(300);

    const noCoupon = mapGoodsToCommercialObject(makeGoods({ couponInfo: undefined }), ctx);
    expect((noCoupon.descriptors[0]!.data.attributes as any).coupon).toBeNull();
  });

  test('多张券时选 isBest=1 那条', () => {
    const obj = mapGoodsToCommercialObject(
      makeGoods({
        couponInfo: {
          couponList: [
            { discount: 5, quota: 50 },
            { discount: 50, quota: 500, isBest: 1 },
            { discount: 10, quota: 100 },
          ],
        },
      }),
      ctx,
    );
    const c = (obj.descriptors[0]!.data.attributes as any).coupon;
    expect(c.discount).toBe(50);
    expect(c.quota).toBe(500);
  });

  test('source_url 来自 materialUrl;缺失时省略字段', () => {
    const with_ = mapGoodsToCommercialObject(makeGoods(), ctx);
    expect(with_.source_url).toBe('https://item.jd.com/100012345678.html');

    const without = mapGoodsToCommercialObject(makeGoods({ materialUrl: undefined }), ctx);
    expect(without.source_url).toBeUndefined();
    expect(without.descriptors[0]!.data.product_url).toBeUndefined();
  });
});
