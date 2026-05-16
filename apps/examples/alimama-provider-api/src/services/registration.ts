/**
 * ProviderRegistration 构造器：生成符合 OCP 协议的注册声明。
 *
 * 这是 Provider 接入 catalog 的"自报家门"：告诉 catalog 我是谁、能保证哪些字段、
 * 用什么 sync capability 推送数据。
 *
 * 参考 OCP schema:packages/ocp-schema/src/index.ts 的 providerRegistrationSchema。
 */
import type { AlimamaConfig } from '../config';

export interface ProviderRegistration {
  ocp_version: '1.0';
  kind: 'ProviderRegistration';
  id: string;
  catalog_id: string;
  registration_version: number;
  updated_at: string;
  provider: {
    provider_id: string;
    entity_type: 'merchant';
    display_name: string;
    homepage: string;
    contact_email?: string;
    domains: string[];
  };
  object_declarations: Array<{
    guaranteed_fields: string[];
    optional_fields: string[];
    sync: {
      preferred_capabilities: string[];
      avoid_capabilities_unless_necessary: string[];
      provider_endpoints: Record<string, unknown>;
    };
  }>;
}

/**
 * 构造本 alimama-provider 的注册声明。
 *
 * 字段集合与 mapper 产出对齐:mapper 必给的字段进 guaranteed,缺失可能的进 optional。
 */
export function buildProviderRegistration(
  cfg: AlimamaConfig,
  version: number,
): ProviderRegistration {
  const homepageHost = new URL(cfg.OCP_PROVIDER_BASE_URL).hostname;

  return {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `reg_${cfg.OCP_PROVIDER_ID}_v${version}`,
    catalog_id: cfg.OCP_CATALOG_ID,
    registration_version: version,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: cfg.OCP_PROVIDER_ID,
      entity_type: 'merchant',
      display_name: 'Alimama Taobao Union Adapter',
      homepage: cfg.OCP_PROVIDER_BASE_URL,
      domains: [homepageHost],
    },
    object_declarations: [
      {
        // ★ guaranteed_fields:mapper 100% 保证给出的字段
        //   对应 catalog 的 ObjectContract.required_fields,缺一个就会被拒
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.product.core.v1#/sku',
          'ocp.commerce.product.core.v1#/image_urls',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
          'ocp.commerce.inventory.v1#/availability_status',
        ],
        // optional_fields:商品有就给,没就省略
        optional_fields: [
          'ocp.commerce.product.core.v1#/brand',
          'ocp.commerce.product.core.v1#/category',
          'ocp.commerce.product.core.v1#/product_url',
          'ocp.commerce.price.v1#/list_amount',
          'ocp.commerce.price.v1#/price_type',
        ],
        sync: {
          // 我们采用主动 push 批量同步
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  };
}
