/**
 * 拼多多 (PDD) 多多客 API 客户端。
 *
 * 两种模式 (由 cfg.PDD_MOCK 控制):
 *   - mock 模式: 从 fixture 读静态响应,**不调网络**。本地开发 / CI 默认走这个。
 *   - real 模式: HTTP POST 到 gw-api.pinduoduo.com/api/router,带 pddSign 签名。
 *
 * 暴露 4 个核心方法:
 *   - listGoods()                调 pdd.ddk.goods.search                    商品搜索
 *   - getGoodsDetail()           调 pdd.ddk.goods.detail                    单品详情
 *   - generatePromotionUrl()     调 pdd.ddk.goods.promotion.url.generate    转链 (resolve 用)
 *   - listOrderIncrement()       调 pdd.ddk.order.list.increment.get        增量订单(按更新时间)
 *
 * 与 JD client 的差异点 (代码层):
 *   - PDD 内层不是 JSON 字符串,直接对象 → extractPddResult 无需二次 JSON.parse
 *   - 业务参数扁平拼接(与 alimama 同),没有 360buy_param_json 嵌套
 *   - 数组参数 (如 goods_id_list) 必须 JSON.stringify 后再传
 *   - timestamp 是 Unix 秒 (字符串形式),不是日期字符串
 *
 * 关键不变量:
 *   - 公共方法返回的是 **内层 result 对象** (从 wrapper key 拆出来后的),
 *     而不是 PDD 网关原始 envelope。mock 与 real 对调用方完全一致。
 *   - 任何业务级失败 (网关 error_response、wrapper 缺失) 都抛 PddApiError。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PddConfig } from '../config';
import { pddSign } from './sign';
import {
  type PddGoodsSearchResult,
  type PddOrderListResult,
  type PddPromotionUrlItem,
  type PddPromotionUrlResult,
  isPddError,
} from './types';

// fixture 路径相对本文件: src/pdd/client.ts → tests/fixtures/*
const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

let _goodsFixtureCache: PddGoodsSearchResult | null = null;
let _promotionFixtureCache: PddPromotionUrlResult | null = null;
let _orderFixtureCache: PddOrderListResult | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadGoodsFixture(): Promise<PddGoodsSearchResult> {
  if (!_goodsFixtureCache) {
    _goodsFixtureCache = await readFixture<PddGoodsSearchResult>('goods-search-sample.json');
  }
  return _goodsFixtureCache;
}

async function loadPromotionFixture(): Promise<PddPromotionUrlResult> {
  if (!_promotionFixtureCache) {
    _promotionFixtureCache = await readFixture<PddPromotionUrlResult>(
      'promotion-url-sample.json',
    );
  }
  return _promotionFixtureCache;
}

async function loadOrderFixture(): Promise<PddOrderListResult> {
  if (!_orderFixtureCache) {
    _orderFixtureCache = await readFixture<PddOrderListResult>('order-list-sample.json');
  }
  return _orderFixtureCache;
}

/** PDD API 调用错误,subCode 可识别业务错误形态以便上层退避。 */
export class PddApiError extends Error {
  constructor(
    public readonly subCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PddApiError';
  }
}

/**
 * 把 JS Date 格式化为 Unix 秒字符串。
 * PDD 网关对 timestamp 字段要求 Unix 秒,与 alimama (日期字符串) 和 JD (北京日期字符串) 都不同。
 */
export function unixSeconds(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

/**
 * 从 PDD 网关原始 envelope 里取出内层 result 对象。
 *
 * PDD 响应形如:
 *   { "goods_search_response": { ...直接是对象,不是 JSON 字符串... } }
 *
 * 比 JD 简单很多 —— 不需要二次 JSON.parse。
 */
function extractPddResult<T>(raw: unknown, wrapperKey: string): T {
  if (typeof raw !== 'object' || raw === null) {
    throw new PddApiError('malformed_response', 'PDD response is not an object');
  }
  const envelope = (raw as Record<string, unknown>)[wrapperKey];
  if (typeof envelope !== 'object' || envelope === null) {
    throw new PddApiError(
      'malformed_response',
      `PDD response missing wrapper key '${wrapperKey}'`,
    );
  }
  return envelope as T;
}

export class PddClient {
  constructor(private readonly cfg: PddConfig) {}

  /**
   * 物料 / 商品搜索。
   *
   * @param opts.keyword    关键词
   * @param opts.page       页码,从 1 开始
   * @param opts.pageSize   每页 (PDD 上限 100)
   * @param opts.catId      类目 ID
   * @param opts.withCoupon 仅返回有券商品
   */
  async listGoods(opts: {
    keyword?: string;
    page: number;
    pageSize: number;
    catId?: number;
    withCoupon?: boolean;
  }): Promise<PddGoodsSearchResult> {
    if (this.cfg.PDD_MOCK) {
      const all = await loadGoodsFixture();
      const data = (all.goods_list ?? []).slice(0, opts.pageSize);
      return {
        goods_list: data,
        total_count: all.goods_list?.length ?? 0,
        list_id: all.list_id ?? `mock_list_${Date.now()}`,
        search_id: all.search_id ?? `mock_search_${Date.now()}`,
      };
    }

    const bizParams: Record<string, string> = {
      page: String(opts.page),
      page_size: String(opts.pageSize),
      ...(opts.keyword ? { keyword: opts.keyword } : {}),
      ...(opts.catId !== undefined ? { cat_id: String(opts.catId) } : {}),
      ...(opts.withCoupon ? { with_coupon: 'true' } : {}),
    };
    const raw = await this.callPdd('pdd.ddk.goods.search', bizParams);
    return extractPddResult<PddGoodsSearchResult>(raw, 'goods_search_response');
  }

  /**
   * 单品详情 (resolve 备选路径)。
   *
   * @param opts.goodsIdList   商品 ID 列表 (PDD 单次最多 20 个)
   */
  async getGoodsDetail(opts: {
    goodsIdList: Array<string | number>;
  }): Promise<PddPromotionUrlItem[]> {
    if (this.cfg.PDD_MOCK) {
      // PoC 阶段 detail 与 promotion 共用一份 fixture
      const all = await loadPromotionFixture();
      return all.goods_promotion_url_list ?? [];
    }

    const bizParams: Record<string, string> = {
      goods_id_list: JSON.stringify(opts.goodsIdList.map((id) => Number(id))),
    };
    const raw = await this.callPdd('pdd.ddk.goods.detail', bizParams);
    const result = extractPddResult<{ goods_details?: PddPromotionUrlItem[] }>(
      raw,
      'goods_detail_response',
    );
    return result.goods_details ?? [];
  }

  /**
   * 转链 (核心动作:Agent resolve 时调用此方法拿带 PID 归因的短链)。
   *
   * @param opts.goodsIdList         商品 ID 列表 (PDD 单次最多 30 个)
   * @param opts.pid                 推广位 (默认 cfg.PDD_PID)
   * @param opts.customParameters    自定义参数 (JSON 字符串,订单回流时原样回显)
   * @param opts.generateShortUrl    是否生成短链 (p.pinduoduo.com/xxx),默认 true
   * @param opts.generateMobile      是否生成 mobile 短链
   */
  async generatePromotionUrl(opts: {
    goodsIdList: Array<string | number>;
    pid?: string;
    customParameters?: string;
    generateShortUrl?: boolean;
    generateMobile?: boolean;
  }): Promise<PddPromotionUrlItem[]> {
    const pid = opts.pid ?? this.cfg.PDD_PID;

    if (this.cfg.PDD_MOCK) {
      // mock: 每个 goodsId 产出一条 deterministic URL,方便快照断言
      return opts.goodsIdList.map((id) => {
        const hash = stableHash(`${pid}_${id}_${opts.customParameters ?? ''}`);
        return {
          url: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}&pid=${pid}&mock=${hash}`,
          short_url: `https://p.pinduoduo.com/mock_${hash}`,
          mobile_short_url: `https://p.pinduoduo.com/mobile_${hash}`,
          we_app_web_view_short_url: `https://mobile.yangkeduo.com/we_app_${hash}`,
          schema_url: `pinduoduo://com.xunmeng.pinduoduo/goods.html?goods_id=${id}&mock=${hash}`,
        };
      });
    }

    const bizParams: Record<string, string> = {
      p_id: pid,
      goods_id_list: JSON.stringify(opts.goodsIdList.map((id) => Number(id))),
      generate_short_url: String(opts.generateShortUrl ?? true),
      ...(opts.generateMobile ? { generate_mobile: 'true' } : {}),
      ...(opts.customParameters ? { custom_parameters: opts.customParameters } : {}),
    };
    const raw = await this.callPdd(
      'pdd.ddk.goods.promotion.url.generate',
      bizParams,
    );
    const result = extractPddResult<PddPromotionUrlResult>(
      raw,
      'goods_promotion_url_generate_response',
    );
    return result.goods_promotion_url_list ?? [];
  }

  /**
   * 增量订单 (按更新时间拉,能捕获迟来的状态变化)。
   *
   * @param opts.startUpdateTime  起始更新时间 (Unix 秒)
   * @param opts.endUpdateTime    结束更新时间 (Unix 秒);跨度 PDD 上限 30 分钟
   * @param opts.page             页码
   * @param opts.pageSize         每页 (上限 100)
   */
  async listOrderIncrement(opts: {
    startUpdateTime: number;
    endUpdateTime: number;
    page: number;
    pageSize: number;
  }): Promise<PddOrderListResult> {
    if (this.cfg.PDD_MOCK) {
      return loadOrderFixture();
    }

    const bizParams: Record<string, string> = {
      start_update_time: String(opts.startUpdateTime),
      end_update_time: String(opts.endUpdateTime),
      page: String(opts.page),
      page_size: String(opts.pageSize),
    };
    const raw = await this.callPdd('pdd.ddk.order.list.increment.get', bizParams);
    return extractPddResult<PddOrderListResult>(raw, 'order_list_get_response');
  }

  /**
   * 内部:对 PDD 网关发起带签名的 POST 请求。
   * 出错时 (含网关错误响应) 抛 PddApiError。
   *
   * @returns 原始 envelope (未拆 wrapper);由调用方用 extractPddResult 取内层。
   */
  private async callPdd(
    type: string,
    bizParams: Record<string, string>,
  ): Promise<unknown> {
    if (!this.cfg.PDD_CLIENT_ID || !this.cfg.PDD_CLIENT_SECRET) {
      throw new Error(
        'PddClient: real 模式但缺 ClientId/ClientSecret (应已被 config 校验拦下)',
      );
    }

    const sysParams: Record<string, string> = {
      type,
      client_id: this.cfg.PDD_CLIENT_ID,
      timestamp: unixSeconds(new Date()),
      data_type: 'JSON',
      version: 'V1',
    };
    const allParams: Record<string, string> = { ...sysParams, ...bizParams };
    const signed: Record<string, string> = {
      ...allParams,
      sign: pddSign(allParams, this.cfg.PDD_CLIENT_SECRET),
    };

    const res = await fetch(this.cfg.PDD_BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(signed).toString(),
      signal: AbortSignal.timeout(this.cfg.PDD_QUERY_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new PddApiError(
        `http_${res.status}`,
        `PDD HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    if (isPddError(data)) {
      throw new PddApiError(
        data.error_response.sub_code ?? `code_${data.error_response.error_code}`,
        data.error_response.sub_msg ?? data.error_response.error_msg,
        data.error_response,
      );
    }
    return data;
  }
}

/**
 * 稳定 hash —— 用于 mock 模式产出可重复的 mock URL。
 * 不需要加密强度,只需要 deterministic + 短。
 */
function stableHash(s: string): string {
  let h = 0;
  for (const ch of s) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return String(Math.abs(h)).slice(0, 8);
}
