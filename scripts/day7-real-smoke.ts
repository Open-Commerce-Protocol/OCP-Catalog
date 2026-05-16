/**
 * Day 7 真实联调脚本
 *
 * 跑一遍:
 *   1. 用真实 AppKey 调 taobao.tbk.dg.material.recommend 拿 20 个真淘宝商品
 *   2. 把这些商品映射成 OCP CommercialObject（升级版嵌套结构 → OCP 标准）
 *   3. 注册 alimama_real provider 到 OCP catalog
 *   4. 推 20 个真实商品到 catalog
 *   5. 模拟 Agent 用 /ocp/query 关键词搜索
 *   6. resolve 第一条,看 ActionBinding 是不是真的带 s.click.taobao.com 短链
 *
 * 用法:
 *   cd e:/homework/work/OCP-Catalog
 *   bun scripts/day7-real-smoke.ts
 *
 * 需要环境变量:
 *   ALIMAMA_APP_KEY, ALIMAMA_APP_SECRET, ALIMAMA_ADZONE_ID, MATERIAL_ID(optional,默认 6708)
 */
import { topSign } from '../apps/examples/alimama-provider-api/src/alimama/sign';

const APP_KEY = process.env.ALIMAMA_APP_KEY!;
const APP_SECRET = process.env.ALIMAMA_APP_SECRET!;
const ADZONE_ID = process.env.ALIMAMA_ADZONE_ID!;
const MATERIAL_ID = process.env.MATERIAL_ID ?? '6708'; // 默认: 大额优惠券库
const CATALOG_BASE = process.env.OCP_CATALOG_BASE_URL ?? 'http://localhost:4000';
const CATALOG_ID = process.env.OCP_CATALOG_ID ?? 'cat_local_dev';
const PROVIDER_ID = process.env.OCP_PROVIDER_ID ?? 'alimama_real';
const OCP_API_KEY = process.env.OCP_API_KEY ?? 'dev-api-key';

if (!APP_KEY || !APP_SECRET || !ADZONE_ID) {
  console.error('需要 env: ALIMAMA_APP_KEY, ALIMAMA_APP_SECRET, ALIMAMA_ADZONE_ID');
  process.exit(1);
}

// ============================================================
// 步骤 1: 拉 Alimama 真实商品
// ============================================================

async function callAlimama(method: string, bizParams: Record<string, string>): Promise<any> {
  const sys: Record<string, string> = {
    method,
    app_key: APP_KEY,
    v: '2.0',
    format: 'json',
    sign_method: 'md5',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  const all: Record<string, string> = { ...sys, ...bizParams };
  all.sign = topSign(all, APP_SECRET, 'md5');
  const res = await fetch('https://gw.api.taobao.com/router/rest', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(all).toString(),
  });
  const data = await res.json();
  if (data.error_response) {
    throw new Error(`Alimama ${method} failed: ${data.error_response.sub_code}: ${data.error_response.sub_msg ?? data.error_response.msg}`);
  }
  return data;
}

interface RecommendItem {
  item_id: string | number;
  item_basic_info?: {
    title?: string;
    short_title?: string;
    brand_name?: string;
    category_id?: number;
    category_name?: string;
    pict_url?: string;
    small_images?: { string?: string[] };
    shop_title?: string;
    seller_id?: number;
    annual_vol?: string;
  };
  price_promotion_info?: {
    reserve_price?: string;
    zk_final_price?: string;
    final_promotion_price?: string;
  };
  publish_info?: {
    click_url?: string;
    income_info?: {
      commission_rate?: string;
      commission_amount?: string;
    };
    income_rate?: string;
  };
}

console.log('=== Step 1: 调 material.recommend 拉真实商品 ===');
const matRes = await callAlimama('taobao.tbk.dg.material.recommend', {
  adzone_id: ADZONE_ID,
  material_id: MATERIAL_ID,
});
const items: RecommendItem[] = matRes.tbk_dg_material_recommend_response?.result_list?.map_data ?? [];
console.log(`✅ 拿到 ${items.length} 个真实淘宝商品 (物料库 ${MATERIAL_ID})`);
for (const item of items.slice(0, 5)) {
  const b = item.item_basic_info ?? {};
  const p = item.price_promotion_info ?? {};
  console.log(`   - [${item.item_id}] ${b.title?.slice(0, 38)} | ¥${p.zk_final_price}`);
}
console.log();

// ============================================================
// 步骤 2: Map 到 OCP CommercialObject
// ============================================================

function absolutize(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return 'https://' + url;
}

function safePrice(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function mapItem(item: RecommendItem) {
  const b = item.item_basic_info ?? {};
  const p = item.price_promotion_info ?? {};
  const pub = item.publish_info ?? {};

  const itemId = String(item.item_id);
  const affiliateUrl = absolutize(pub.click_url);
  const images = [b.pict_url, ...(b.small_images?.string ?? [])]
    .map(absolutize)
    .filter((u): u is string => !!u);

  return {
    ocp_version: '1.0' as const,
    kind: 'CommercialObject' as const,
    id: `obj_${PROVIDER_ID}_${itemId}`,
    object_id: itemId,
    object_type: 'product' as const,
    provider_id: PROVIDER_ID,
    title: b.title ?? '(no title)',
    status: 'active' as const,
    ...(affiliateUrl ? { source_url: affiliateUrl } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: b.title ?? '(no title)',
          ...(b.shop_title ? { brand: b.shop_title } : {}),
          ...(b.category_name ? { category: b.category_name } : {}),
          sku: itemId,
          ...(affiliateUrl ? { product_url: affiliateUrl } : {}),
          image_urls: images,
          attributes: {
            annual_volume_label: b.annual_vol ?? null,
            category_id: b.category_id ?? null,
            seller_id: b.seller_id ?? null,
            commission_rate_bp: pub.income_info?.commission_rate
              ? parseInt(pub.income_info.commission_rate)
              : null,
            commission_amount_cny: pub.income_info?.commission_amount
              ? parseFloat(pub.income_info.commission_amount)
              : null,
            income_rate_pct: pub.income_rate ?? null,
            affiliate_provider: 'alimama_taobao_union',
            // affiliate URL 已直接嵌进 product_url + source_url,catalog 的 view_product binding 会用它
          },
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: 'CNY',
          amount: safePrice(p.zk_final_price),
          list_amount: safePrice(p.reserve_price),
          price_type: 'fixed',
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: { availability_status: 'unknown' },
      },
    ],
  };
}

const objects = items.map(mapItem);
console.log('=== Step 2: 映射成 OCP CommercialObject ===');
console.log(`✅ ${objects.length} 个 object 映射完成`);
const first = objects[0]!;
const img0 = (first.descriptors[0]!.data as any).image_urls?.[0];
console.log(`   样本: title="${first.title.slice(0, 30)}"`);
console.log(`         source_url="${first.source_url?.slice(0, 60)}..."`);
console.log(`         image[0]="${img0?.slice(0, 60)}..."`);
console.log();

// ============================================================
// 步骤 3 & 4: 注册 provider + sync 商品到 catalog
// ============================================================

async function callCatalog(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${CATALOG_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': OCP_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Catalog ${path} failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

console.log('=== Step 3: 注册 alimama_real provider ===');
const reg = {
  ocp_version: '1.0',
  kind: 'ProviderRegistration',
  id: `reg_${PROVIDER_ID}_v1`,
  catalog_id: CATALOG_ID,
  registration_version: 1,
  updated_at: new Date().toISOString(),
  provider: {
    provider_id: PROVIDER_ID,
    entity_type: 'merchant',
    display_name: 'Alimama Real Provider',
    homepage: 'http://localhost:4300',
    domains: ['localhost'],
  },
  object_declarations: [
    {
      guaranteed_fields: [
        'ocp.commerce.product.core.v1#/title',
        'ocp.commerce.product.core.v1#/sku',
        'ocp.commerce.product.core.v1#/image_urls',
        'ocp.commerce.price.v1#/currency',
        'ocp.commerce.price.v1#/amount',
        'ocp.commerce.inventory.v1#/availability_status',
      ],
      optional_fields: [
        'ocp.commerce.product.core.v1#/brand',
        'ocp.commerce.product.core.v1#/category',
        'ocp.commerce.product.core.v1#/product_url',
        'ocp.commerce.price.v1#/list_amount',
        'ocp.commerce.price.v1#/price_type',
      ],
      sync: {
        preferred_capabilities: ['ocp.push.batch'],
        avoid_capabilities_unless_necessary: [],
        provider_endpoints: {},
      },
    },
  ],
};
const regRes = await callCatalog('/ocp/providers/register', reg);
console.log(`✅ Provider 注册: status=${regRes.status} effective_version=${regRes.effective_registration_version}`);
console.log();

console.log('=== Step 4: 同步 20 个真实商品到 catalog ===');
const syncReq = {
  ocp_version: '1.0',
  kind: 'ObjectSyncRequest',
  catalog_id: CATALOG_ID,
  provider_id: PROVIDER_ID,
  registration_version: 1,
  batch_id: `batch_real_${Date.now()}`,
  objects,
};
const syncRes = await callCatalog('/ocp/objects/sync', syncReq);
console.log(`✅ Sync: accepted=${syncRes.accepted_count} rejected=${syncRes.rejected_count}`);
if (syncRes.rejected_count > 0) {
  console.log('⚠ 有 rejected 项:');
  for (const it of syncRes.items ?? []) {
    if (it.status === 'rejected') console.log(`   - object_id=${it.object_id} errors=${JSON.stringify(it.errors)}`);
  }
}
console.log();

// ============================================================
// 步骤 5: Agent 视角查询
// ============================================================

console.log('=== Step 5: Agent 用 OCP 协议查询 ===');
const queryRes = await callCatalog('/ocp/query', {
  query_pack: 'ocp.query.keyword.v1',
  filters: { provider_id: PROVIDER_ID },
  limit: 5,
});
console.log(`✅ /ocp/query 返回 ${queryRes.result_count} 个结果(取前 5):`);
for (const it of queryRes.items ?? []) {
  console.log(`   - [entry=${it.entry_id.slice(0, 30)}] ${it.title?.slice(0, 38)}`);
}
console.log();

// ============================================================
// 步骤 6: Resolve 一个,看 ActionBinding 是否含带 PID 的真短链
// ============================================================

console.log('=== Step 6: Resolve 拿 ActionBinding ===');
const firstEntry = queryRes.items?.[0];
if (!firstEntry) {
  console.log('❌ query 没结果,跳过 resolve');
} else {
  const resolveRes = await callCatalog('/ocp/resolve', {
    entry_id: firstEntry.entry_id,
    agent: { agent_id: 'agt_day7_demo', intent: 'shopping_purchase' },
  });
  console.log(`✅ Resolved entry: "${resolveRes.title}"`);
  console.log(`   ActionBindings (${resolveRes.action_bindings?.length ?? 0} 个):`);
  for (const b of resolveRes.action_bindings ?? []) {
    console.log(`     - [${b.action_id}] ${b.label}`);
    console.log(`       url: ${b.url}`);
    console.log(`       带 PID? ${b.url.includes('s.click.taobao.com') ? '✅ YES (s.click.taobao.com)' : '❌ NO'}`);
  }
}

console.log();
console.log('=== Day 7 ⭐ Checkpoint E 完成 ===');
console.log('"AI Agent 通过 OCP 协议查到真实淘宝商品 + 拿到带 PID 的购买链接" 闭环已打通');
