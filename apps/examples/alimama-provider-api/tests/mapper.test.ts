import { describe, expect, test } from 'bun:test';
import {
  absolutize,
  mapMaterialToCommercialObject,
  safePrice,
  type MapperContext,
} from '../src/mapper/material-to-object';
import fixture from './fixtures/material-optional-sample.json';
import type { AlimamaMaterialItem } from '../src/alimama/types';

const items = fixture.tbk_dg_material_optional_response.result_list.map_data as AlimamaMaterialItem[];

const ctx: MapperContext = {
  providerId: 'alimama_test',
  providerBaseUrl: 'http://localhost:4300',
};

// ============================================================
// 辅助函数单测
// ============================================================

describe('absolutize', () => {
  test('//gw.alicdn.com 补 https:', () => {
    expect(absolutize('//gw.alicdn.com/x.jpg')).toBe('https://gw.alicdn.com/x.jpg');
  });

  test('https:// 原样返回', () => {
    expect(absolutize('https://example.com/x')).toBe('https://example.com/x');
  });

  test('http:// 原样返回', () => {
    expect(absolutize('http://example.com/x')).toBe('http://example.com/x');
  });

  test('裸域名补 https://', () => {
    expect(absolutize('example.com/x.jpg')).toBe('https://example.com/x.jpg');
  });

  test('undefined / null / 空 → undefined', () => {
    expect(absolutize(undefined)).toBeUndefined();
    expect(absolutize(null)).toBeUndefined();
    expect(absolutize('')).toBeUndefined();
    expect(absolutize('   ')).toBeUndefined();
  });
});

describe('safePrice', () => {
  test('正常字符串 → number', () => {
    expect(safePrice('199.00')).toBe(199);
    expect(safePrice('9.90')).toBe(9.9);
  });

  test('空 / 异常 / NaN / 负数 → 0', () => {
    expect(safePrice(undefined)).toBe(0);
    expect(safePrice(null)).toBe(0);
    expect(safePrice('')).toBe(0);
    expect(safePrice('abc')).toBe(0);
    expect(safePrice('-10')).toBe(0);
  });
});

// ============================================================
// Mapper 主体
// ============================================================

describe('mapMaterialToCommercialObject', () => {
  test('生成的 image_urls 全部以 https:// 开头', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      const urls = obj.descriptors[0]!.data.image_urls as string[];
      for (const u of urls) {
        expect(u).toMatch(/^https:\/\//);
      }
    }
  });

  test('image_urls 数量正确：主图始终在;副图按 small_images 真实情况', () => {
    // item #1: 1 主 + 3 副 = 4
    const obj1 = mapMaterialToCommercialObject(items[0]!, ctx);
    expect((obj1.descriptors[0]!.data.image_urls as string[]).length).toBe(4);

    // item #2: small_images = null → 1 主
    const obj2 = mapMaterialToCommercialObject(items[1]!, ctx);
    expect((obj2.descriptors[0]!.data.image_urls as string[]).length).toBe(1);

    // item #3: small_images = {string: []} 空数组 → 1 主
    const obj3 = mapMaterialToCommercialObject(items[2]!, ctx);
    expect((obj3.descriptors[0]!.data.image_urls as string[]).length).toBe(1);

    // item #6: small_images 字段完全缺失 → 1 主
    const obj6 = mapMaterialToCommercialObject(items[5]!, ctx);
    expect((obj6.descriptors[0]!.data.image_urls as string[]).length).toBe(1);
  });

  test('包含三个 descriptor pack', () => {
    const obj = mapMaterialToCommercialObject(items[0]!, ctx);
    const packIds = obj.descriptors.map((d) => d.pack_id);
    expect(packIds).toEqual([
      'ocp.commerce.product.core.v1',
      'ocp.commerce.price.v1',
      'ocp.commerce.inventory.v1',
    ]);
  });

  test('attributes 只含 affiliate 描述信息，不声明 action endpoint', () => {
    const obj = mapMaterialToCommercialObject(items[0]!, ctx);
    const attrs = obj.descriptors[0]!.data.attributes as Record<string, unknown>;
    expect(attrs.requires_affiliate_resolution).toBeUndefined();
    expect(attrs.provider_resolve_hook_url).toBeUndefined();
    expect(attrs.action_endpoint).toBeUndefined();
    expect(attrs.affiliate_provider).toBe('alimama_taobao_union');
  });

  test('price 是 number 不是 string', () => {
    const obj = mapMaterialToCommercialObject(items[0]!, ctx);
    const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data;
    expect(typeof price.amount).toBe('number');
    expect(typeof price.list_amount).toBe('number');
    expect(price.amount).toBe(199); // item #1 zk_final_price="199.00"
    expect(price.list_amount).toBe(299); // item #1 reserve_price="299.00"
    expect(price.currency).toBe('CNY');
    expect(price.price_type).toBe('fixed');
  });

  test('user_type=1 → platform=tmall, user_type=0 → platform=taobao', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      const attrs = obj.descriptors[0]!.data.attributes as Record<string, unknown>;
      const expected = item.user_type === 1 ? 'tmall' : 'taobao';
      expect(attrs.platform).toBe(expected);
    }
  });

  test('inventory.availability_status 总是 unknown (alimama 不给库存)', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      const inv = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1')!.data;
      expect(inv.availability_status).toBe('unknown');
    }
  });

  test('有券商品 → attributes.coupon 是对象; 无券 → null', () => {
    // item #1 有券
    const withCoupon = mapMaterialToCommercialObject(items[0]!, ctx);
    const attrs1 = withCoupon.descriptors[0]!.data.attributes as Record<string, any>;
    expect(attrs1.coupon).not.toBeNull();
    expect(attrs1.coupon.info).toBe('满199元减50元');
    expect(attrs1.coupon.remain_count).toBe(8421);

    // item #2 无券
    const noCoupon = mapMaterialToCommercialObject(items[1]!, ctx);
    const attrs2 = noCoupon.descriptors[0]!.data.attributes as Record<string, any>;
    expect(attrs2.coupon).toBeNull();
  });

  test('id / object_id / sku 三者一致', () => {
    const obj = mapMaterialToCommercialObject(items[0]!, ctx);
    expect(obj.id).toBe('obj_alimama_test_700123456001');
    expect(obj.object_id).toBe('700123456001');
    const sku = (obj.descriptors[0]!.data as Record<string, unknown>).sku;
    expect(sku).toBe('700123456001');
  });

  test('OCP required fields 全部就位 (title + currency + amount)', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      expect(obj.title).toBeTruthy();
      const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data;
      expect(price.currency).toBe('CNY');
      expect(typeof price.amount).toBe('number');
    }
  });

  test('可选字段(brand/category) 缺失时优雅省略而不是 undefined', () => {
    // item #6 缺 shop_title
    const obj6 = mapMaterialToCommercialObject(items[5]!, ctx);
    const data = obj6.descriptors[0]!.data as Record<string, unknown>;
    expect('brand' in data).toBe(false); // brand 应该完全不出现
  });

  test('status 始终是 active (alimama 物料默认在售)', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      expect(obj.status).toBe('active');
    }
  });

  test('object_type 始终是 product', () => {
    for (const item of items) {
      const obj = mapMaterialToCommercialObject(item, ctx);
      expect(obj.object_type).toBe('product');
    }
  });

  test('CommercialObject 顶层 ocp_version + kind 正确', () => {
    const obj = mapMaterialToCommercialObject(items[0]!, ctx);
    expect(obj.ocp_version).toBe('1.0');
    expect(obj.kind).toBe('CommercialObject');
  });
});
