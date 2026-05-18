/**
 * 阿里妈妈淘宝联盟 API 客户端。
 *
 * 两种模式（由 cfg.ALIMAMA_MOCK 控制）：
 *   - mock 模式：从 fixture 读静态响应，**不调网络**。本地开发 / CI 默认走这个。
 *   - real 模式：HTTP POST 到 gw.api.taobao.com/router/rest，带 topSign 签名。
 *
 * 仅暴露 2 个核心方法：
 *   - listMaterial()         调 taobao.tbk.dg.material.optional 拉商品池
 *   - generatePrivilegeLink() 调 taobao.tbk.privilege.get 拿带 PID 的购买链接
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AlimamaConfig } from '../config';
import { topSign } from './sign';
import {
  type AlimamaMaterialItem,
  type AlimamaMaterialResponse,
  type AlimamaOrderResponse,
  type AlimamaPrivilegeResponse,
  isAlimamaError,
} from './types';

// fixture 路径相对本文件:src/alimama/client.ts → tests/fixtures/*
const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

let _materialFixtureCache: AlimamaMaterialResponse | null = null;
let _privilegeFixtureCache: AlimamaPrivilegeResponse | null = null;
let _orderFixtureCache: AlimamaOrderResponse | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadMaterialFixture(): Promise<AlimamaMaterialResponse> {
  if (!_materialFixtureCache) {
    _materialFixtureCache = await readFixture<AlimamaMaterialResponse>(
      'material-optional-sample.json',
    );
  }
  return _materialFixtureCache;
}

async function loadPrivilegeFixture(): Promise<AlimamaPrivilegeResponse> {
  if (!_privilegeFixtureCache) {
    _privilegeFixtureCache = await readFixture<AlimamaPrivilegeResponse>(
      'privilege-get-sample.json',
    );
  }
  return _privilegeFixtureCache;
}

async function loadOrderFixture(): Promise<AlimamaOrderResponse> {
  if (!_orderFixtureCache) {
    _orderFixtureCache = await readFixture<AlimamaOrderResponse>('order-get-sample.json');
  }
  return _orderFixtureCache;
}

/** 阿里 API 调用错误（含可识别的 sub_code 便于上层退避） */
export class AlimamaApiError extends Error {
  constructor(
    public readonly subCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AlimamaApiError';
  }
}

export class AlimamaClient {
  constructor(private readonly cfg: AlimamaConfig) {}

  /**
   * 拉物料（商品池）。
   * @param opts.q          关键词搜索
   * @param opts.cat        类目过滤
   * @param opts.pageNo     页码，从 1 开始
   * @param opts.pageSize   每页数量，最大 100
   * @param opts.adzoneId   推广位（默认用 cfg.ALIMAMA_ADZONE_ID）
   */
  async listMaterial(opts: {
    q?: string;
    cat?: string;
    pageNo: number;
    pageSize: number;
    adzoneId?: string;
  }): Promise<AlimamaMaterialResponse> {
    if (this.cfg.ALIMAMA_MOCK) {
      // mock 模式:返回 fixture,按 pageSize 切片
      const all = await loadMaterialFixture();
      const items = all.tbk_dg_material_optional_response.result_list.map_data;
      const sliced = items.slice(0, opts.pageSize);
      return {
        tbk_dg_material_optional_response: {
          total_results: items.length,
          result_list: { map_data: sliced },
        },
      };
    }

    const upgraded = await this.callTop<AlimamaMaterialOptionalUpgradeResponse>('taobao.tbk.dg.material.optional.upgrade', {
      ...(opts.q ? { q: opts.q } : {}),
      ...(opts.cat ? { cat: opts.cat } : {}),
      page_no: String(opts.pageNo),
      page_size: String(opts.pageSize),
      adzone_id: opts.adzoneId ?? this.cfg.ALIMAMA_ADZONE_ID,
    });

    return normalizeMaterialOptionalUpgrade(upgraded);
  }

  /**
   * 按 item_id 查询单个物料的最新信息（含 publish_info.click_url affiliate URL）。
   *
   * Resolve 阶段用它**取代** taobao.tbk.privilege.get —— privilege.get 要 TOP session
   * （OAuth 用户授权），这条路在无 session 环境里走不通；material.optional.upgrade
   * 不需要 session 但同样返带 PID 归因的 affiliate URL（在 publish_info.click_url 里）。
   *
   * @param opts.itemId    商品 num_iid（或 catalog query 返回的 entry_id 拆出的 id）
   * @param opts.adzoneId  推广位 ID（决定佣金归谁；默认 cfg.ALIMAMA_ADZONE_ID）
   * @returns              单个 AlimamaMaterialItem 或 null（未命中）
   */
  async getMaterialByItemId(opts: {
    itemId: string;
    adzoneId?: string;
  }): Promise<AlimamaMaterialItem | null> {
    if (this.cfg.ALIMAMA_MOCK) {
      // mock 模式:从 fixture 找 id 匹配的条目；没匹配就返第一条作为兜底
      const all = await loadMaterialFixture();
      const items = all.tbk_dg_material_optional_response.result_list.map_data;
      const matched = items.find((i) => String(i.num_iid) === String(opts.itemId));
      return matched ?? items[0] ?? null;
    }

    const upgraded = await this.callTop<AlimamaMaterialOptionalUpgradeResponse>(
      'taobao.tbk.dg.material.optional.upgrade',
      {
        item_id_list: String(opts.itemId),
        page_no: '1',
        page_size: '1',
        adzone_id: opts.adzoneId ?? this.cfg.ALIMAMA_ADZONE_ID,
      },
    );

    const normalized = normalizeMaterialOptionalUpgrade(upgraded);
    const items = normalized.tbk_dg_material_optional_response.result_list.map_data;
    return items[0] ?? null;
  }

  /**
   * 转链 (核心动作:Agent resolve 时调用此方法拿带 PID 的短链)。
   * @param opts.itemId      商品 num_iid
   * @param opts.adzoneId    推广位 ID,决定佣金归到哪
   * @param opts.externalId  外部业务 ID,会出现在订单回执（用于 OCP entry_id 归因）
   *
   * @deprecated 此 API 要求 TOP session。新代码请用 {@link getMaterialByItemId} +
   *             {@link materialToAffiliateLinks} 获取 affiliate URL,等同效果但不需 session。
   *             保留导出仅为向后兼容(测试 / 万一拿到 session 时还能用)。
   */
  async generatePrivilegeLink(opts: {
    itemId: string;
    adzoneId?: string;
    externalId?: string;
  }): Promise<AlimamaPrivilegeResponse> {
    if (this.cfg.ALIMAMA_MOCK) {
      return loadPrivilegeFixture();
    }

    return this.callTop<AlimamaPrivilegeResponse>('taobao.tbk.privilege.get', {
      item_id: opts.itemId,
      adzone_id: opts.adzoneId ?? this.cfg.ALIMAMA_ADZONE_ID,
      ...(opts.externalId ? { external_id: opts.externalId } : {}),
    });
  }

  /**
   * 拉订单回执（佣金回流的数据源）。
   * @param opts.startTime  起始时间 "YYYY-MM-DD HH:mm:ss"
   * @param opts.endTime    结束时间
   * @param opts.queryType  查询类型:'create_time' | 'pay_time' | 'settle_time'
   * @param opts.pageNo     页码
   * @param opts.pageSize   每页(最大 100)
   */
  async listOrders(opts: {
    startTime: string;
    endTime: string;
    queryType: 'create_time' | 'pay_time' | 'settle_time';
    pageNo: number;
    pageSize: number;
  }): Promise<AlimamaOrderResponse> {
    if (this.cfg.ALIMAMA_MOCK) {
      return loadOrderFixture();
    }
    return this.callTop<AlimamaOrderResponse>('taobao.tbk.order.get', {
      start_time: opts.startTime,
      end_time: opts.endTime,
      query_type: opts.queryType,
      page_no: String(opts.pageNo),
      page_size: String(opts.pageSize),
    });
  }

  /**
   * 内部:发起带签名的 POST 请求到阿里网关。
   * 出错时（含 alimama 业务错误码）抛 AlimamaApiError。
   */
  private async callTop<T>(
    method: string,
    bizParams: Record<string, string>,
  ): Promise<T> {
    if (!this.cfg.ALIMAMA_APP_KEY || !this.cfg.ALIMAMA_APP_SECRET) {
      throw new Error('AlimamaClient: real 模式但缺 AppKey/AppSecret（应已被 config 校验拦下）');
    }

    const sysParams: Record<string, string> = {
      method,
      app_key: this.cfg.ALIMAMA_APP_KEY,
      v: '2.0',
      format: 'json',
      sign_method: 'md5',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    const allParams: Record<string, string> = { ...sysParams, ...bizParams };
    const signed: Record<string, string> = {
      ...allParams,
      sign: topSign(allParams, this.cfg.ALIMAMA_APP_SECRET, 'md5'),
    };

    const res = await fetch(this.cfg.ALIMAMA_BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(signed).toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new AlimamaApiError(
        `http_${res.status}`,
        `Alimama HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    if (isAlimamaError(data)) {
      throw new AlimamaApiError(
        data.error_response.sub_code ?? `code_${data.error_response.code}`,
        data.error_response.sub_msg ?? data.error_response.msg,
        data.error_response,
      );
    }

    return data as T;
  }
}

type AlimamaMaterialOptionalUpgradeResponse = {
  tbk_dg_material_optional_upgrade_response: {
    total_results?: number;
    result_list?: {
      map_data?: Array<{
        item_id?: string | number;
        item_basic_info?: {
          brand_name?: string;
          category_id?: number;
          category_name?: string;
          pict_url?: string;
          seller_id?: number;
          shop_title?: string;
          title?: string;
          tk_total_sales?: string;
          user_type?: number;
          volume?: number;
          white_image?: string;
        };
        price_promotion_info?: {
          final_promotion_price?: string;
          reserve_price?: string;
          zk_final_price?: string;
          final_promotion_path_list?: {
            final_promotion_path_map_data?: Array<{
              promotion_desc?: string;
              promotion_end_time?: string;
              promotion_fee?: string;
              promotion_id?: string;
              promotion_start_time?: string;
              promotion_title?: string;
            }>;
          };
        };
        publish_info?: {
          click_url?: string;
          coupon_share_url?: string;
          income_info?: {
            commission_rate?: string;
          };
        };
      }>;
    };
  };
};

function normalizeMaterialOptionalUpgrade(
  response: AlimamaMaterialOptionalUpgradeResponse,
): AlimamaMaterialResponse {
  const payload = response.tbk_dg_material_optional_upgrade_response;
  const items = payload.result_list?.map_data ?? [];

  return {
    tbk_dg_material_optional_response: {
      total_results: payload.total_results ?? items.length,
      result_list: {
        map_data: items.map((item) => {
          const basic = item.item_basic_info ?? {};
          const price = item.price_promotion_info ?? {};
          const publish = item.publish_info ?? {};
          const primaryPromotion = price.final_promotion_path_list
            ?.final_promotion_path_map_data
            ?.find((promotion) => promotion.promotion_title?.includes('券') || promotion.promotion_desc);

          return {
            num_iid: item.item_id ?? '',
            title: basic.title ?? '',
            pict_url: basic.pict_url ?? basic.white_image ?? '',
            small_images: basic.white_image && basic.white_image !== basic.pict_url
              ? { string: [basic.white_image] }
              : null,
            item_url: publish.click_url ?? publish.coupon_share_url ?? '',
            reserve_price: price.reserve_price ?? price.zk_final_price ?? price.final_promotion_price ?? '0',
            zk_final_price: price.final_promotion_price ?? price.zk_final_price ?? price.reserve_price ?? '0',
            user_type: basic.user_type ?? 0,
            shop_title: basic.brand_name || basic.shop_title,
            seller_id: basic.seller_id,
            category_id: basic.category_id,
            cat: basic.category_name ?? (basic.category_id !== undefined ? String(basic.category_id) : undefined),
            volume: basic.volume,
            commission_rate: publish.income_info?.commission_rate,
            tk_total_sales: basic.tk_total_sales,
            coupon_info: primaryPromotion?.promotion_desc ?? null,
            coupon_start_time: normalizeTimestampMillis(primaryPromotion?.promotion_start_time),
            coupon_end_time: normalizeTimestampMillis(primaryPromotion?.promotion_end_time),
          };
        }),
      },
    },
  };
}

function normalizeTimestampMillis(value: string | undefined) {
  if (!value) return null;
  const millis = Number(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString().slice(0, 10);
}
