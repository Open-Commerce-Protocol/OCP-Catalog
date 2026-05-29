/**
 * 京东联盟 (JD Union) API 客户端。
 *
 * 两种模式 (由 cfg.JDUNION_MOCK 控制):
 *   - mock 模式: 从 fixture 读静态响应,**不调网络**。本地开发 / CI 默认走这个。
 *   - real 模式: HTTP POST 到 router.jd.com/api,带 jdSign 签名。
 *
 * 暴露 4 个核心方法:
 *   - listGoods()                调 jd.union.open.goods.query                       拉商品池
 *   - getPromotionGoodsInfo()    调 jd.union.open.goods.promotiongoodsinfo.query    单品 + affiliate URL
 *   - getPromotionCommonLink()   调 jd.union.open.promotion.common.get              显式转链(备选)
 *   - listOrderRows()            调 jd.union.open.order.row.query                   订单回流
 *
 * 关键不变量:
 *   - 公共方法返回的是 **JSON.parse 后的内层 result 对象**,而不是 JD 网关原始 envelope。
 *     这让 mock 与 real 两个分支对调用方完全一致 (fixture 里也只存内层 result)。
 *   - 任何业务级失败 (网关 error_response、外层 code != 200、内层 result.code != 200)
 *     都抛 JdApiError,subCode 字段尽量带上以便上层退避策略识别。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JdUnionConfig } from '../config';
import { jdSign } from './sign';
import {
  type JdGoodsQueryResult,
  type JdOrderRowResult,
  type JdPromotionCommonRequest,
  type JdPromotionCommonResult,
  type JdPromotionGoodsResult,
  isJdGatewayError,
} from './types';

// fixture 路径相对本文件: src/jd/client.ts → tests/fixtures/*
const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

let _goodsFixtureCache: JdGoodsQueryResult | null = null;
let _promotionGoodsFixtureCache: JdPromotionGoodsResult | null = null;
let _orderFixtureCache: JdOrderRowResult | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadGoodsFixture(): Promise<JdGoodsQueryResult> {
  if (!_goodsFixtureCache) {
    _goodsFixtureCache = await readFixture<JdGoodsQueryResult>('goods-query-sample.json');
  }
  return _goodsFixtureCache;
}

async function loadPromotionGoodsFixture(): Promise<JdPromotionGoodsResult> {
  if (!_promotionGoodsFixtureCache) {
    _promotionGoodsFixtureCache = await readFixture<JdPromotionGoodsResult>(
      'promotiongoodsinfo-sample.json',
    );
  }
  return _promotionGoodsFixtureCache;
}

async function loadOrderFixture(): Promise<JdOrderRowResult> {
  if (!_orderFixtureCache) {
    _orderFixtureCache = await readFixture<JdOrderRowResult>('order-row-sample.json');
  }
  return _orderFixtureCache;
}

/** JD API 调用错误。subCode 可识别业务错误形态以便上层做退避。 */
export class JdApiError extends Error {
  constructor(
    public readonly subCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'JdApiError';
  }
}

/**
 * 把 JS Date 格式化为北京时间 'YYYY-MM-DD HH:mm:ss'。
 * JD 网关对 timestamp 字段要求北京时区。
 */
export function formatBeijingTimestamp(d: Date): string {
  const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 从 JD 网关原始 envelope 里取出内层 result 对象。
 *
 * JD 响应形如:
 *   { "jd_union_open_xxx_responce": { "code": "200", "queryResult": "<JSON 字符串>" } }
 *
 * 1) 顶层 wrapperKey 不存在 → 不识别响应,抛 'malformed_response'
 * 2) 外层 code != "200"     → 抛 'gateway_code_<n>'
 * 3) 内层 data 字段缺失      → 抛 'empty_result'
 * 4) 内层 JSON.parse 失败    → 抛 'malformed_inner_json'
 * 5) 内层 code != 200        → 抛 'business_code_<n>'
 * 6) 成功返回内层 result
 */
function extractJdResult<T extends { code: number; message?: string }>(
  raw: unknown,
  wrapperKey: string,
  dataField: string,
): T {
  if (typeof raw !== 'object' || raw === null) {
    throw new JdApiError('malformed_response', 'JD response is not an object');
  }
  const envelope = (raw as Record<string, unknown>)[wrapperKey];
  if (typeof envelope !== 'object' || envelope === null) {
    throw new JdApiError(
      'malformed_response',
      `JD response missing wrapper key '${wrapperKey}'`,
    );
  }
  const envelopeObj = envelope as Record<string, unknown>;
  const outerCode = envelopeObj.code;
  // 网关层成功码:router.jd.com 用 "200",api.jd.com/routerjson 用 "0"
  const OUTER_OK = new Set(['200', '0', 200, 0]);
  if (outerCode !== undefined && !OUTER_OK.has(outerCode as string | number)) {
    throw new JdApiError(
      `gateway_code_${String(outerCode)}`,
      `JD gateway returned code=${String(outerCode)}`,
      envelopeObj,
    );
  }
  // api.jd.com/routerjson 把内层 JSON 统一放在 'queryResult',
  // 老的 router.jd.com 才会用各 API 专属的字段名(如 getpromotiongoodsinfo_result)。
  // 优先按传入的字段找,找不到则回落到 'queryResult'。
  const dataKey = dataField in envelopeObj ? dataField : 'queryResult';
  const dataStr = envelopeObj[dataKey];
  if (typeof dataStr !== 'string') {
    // 某些 API 直接返回对象而非字符串,放过
    if (typeof dataStr === 'object' && dataStr !== null) {
      return dataStr as T;
    }
    throw new JdApiError(
      'empty_result',
      `JD response missing data field '${dataField}' or fallback 'queryResult'`,
      envelopeObj,
    );
  }
  let parsed: T;
  try {
    parsed = JSON.parse(dataStr) as T;
  } catch {
    throw new JdApiError('malformed_inner_json', `Failed to JSON.parse '${dataKey}'`);
  }
  if (parsed.code !== 200) {
    throw new JdApiError(
      `business_code_${parsed.code}`,
      parsed.message ?? `JD business code=${parsed.code}`,
      parsed,
    );
  }
  return parsed;
}

export class JdUnionClient {
  constructor(private readonly cfg: JdUnionConfig) {}

  /**
   * 拼 PID。工具商账号(有 MEDIA_ID)走 3 段 `union_id_media_id_position_id`,
   * 标准联盟账号退化为 2 段 `union_id_position_id`。
   */
  private buildPid(positionId?: string): string {
    const pos = positionId ?? this.cfg.JDUNION_POSITION_ID;
    return this.cfg.JDUNION_MEDIA_ID
      ? `${this.cfg.JDUNION_UNION_ID}_${this.cfg.JDUNION_MEDIA_ID}_${pos}`
      : `${this.cfg.JDUNION_UNION_ID}_${pos}`;
  }

  /**
   * siteId 只在显式配置时才返回。
   * 实证发现 JD 的逻辑是矛盾的:工具商 + 3 段 PID 模式下,
   *   - 不传 siteId 报 1002024 "siteId不能为空"
   *   - 传 siteId  报 2001701 "不支持siteId用于此种方式推广,只支持网站/APP"
   * 实际是看推广方式: "网站/APP" 时必填 siteId,"社交媒体/Agent" 时禁传。
   * 所以本字段只在 JDUNION_SITE_ID 显式配置时才透传,由运营按账号类型决定。
   */
  private resolveSiteId(): string | undefined {
    return this.cfg.JDUNION_SITE_ID;
  }

  /**
   * 物料/商品搜索。
   *
   * @param opts.keyword     关键词 (留空时按热销/精选返)
   * @param opts.pageIndex   页码,从 1 开始
   * @param opts.pageSize    每页 (JD 上限 30)
   * @param opts.eliteId     精选活动 ID (可选,如 1=好券商品 4=今日推荐 等)
   * @param opts.positionId  推广位 (默认用 cfg.JDUNION_POSITION_ID)
   */
  async listGoods(opts: {
    keyword?: string;
    pageIndex: number;
    pageSize: number;
    eliteId?: number;
    positionId?: string;
  }): Promise<JdGoodsQueryResult> {
    if (this.cfg.JDUNION_MOCK) {
      const all = await loadGoodsFixture();
      const data = (all.data ?? []).slice(0, opts.pageSize);
      return {
        code: 200,
        requestId: `mock_${Date.now()}`,
        totalCount: all.data?.length ?? 0,
        hasMore: (all.data?.length ?? 0) > opts.pageSize,
        data,
      };
    }

    const bizParams: Record<string, unknown> = {
      goodsReqDTO: {
        ...(opts.keyword ? { keyword: opts.keyword } : {}),
        pageIndex: opts.pageIndex,
        pageSize: opts.pageSize,
        ...(opts.eliteId !== undefined ? { eliteId: opts.eliteId } : {}),
        ...(opts.positionId ? { pid: this.buildPid(opts.positionId) } : {}),
      },
    };
    const raw = await this.callJd('jd.union.open.goods.query', bizParams);
    return extractJdResult<JdGoodsQueryResult>(
      raw,
      'jd_union_open_goods_query_responce',
      'queryResult',
    );
  }

  /**
   * 批量取单品 + 推广信息 (resolve 默认走这个 API)。
   * 单 API 同时拿到佣金率 / 价格 / affiliate URL,与 alimama 用 material.optional.upgrade 同构。
   *
   * @param opts.skuIds      SKU 数组 (JD 单次最多 100 个)
   * @param opts.positionId  推广位 (默认 cfg.JDUNION_POSITION_ID)
   * @param opts.subUnionId  子渠道标识(用于 per-agent 归因,可选)
   */
  async getPromotionGoodsInfo(opts: {
    skuIds: Array<string | number>;
    positionId?: string;
    subUnionId?: string;
  }): Promise<JdPromotionGoodsResult> {
    if (this.cfg.JDUNION_MOCK) {
      const all = await loadPromotionGoodsFixture();
      const requested = new Set(opts.skuIds.map((id) => String(id)));
      const matched = (all.result ?? []).filter((item) => requested.has(String(item.skuId)));
      const result = matched.length > 0 ? matched : (all.result ?? []).slice(0, 1);
      return {
        code: 200,
        requestId: `mock_${Date.now()}`,
        result,
      };
    }

    const bizParams: Record<string, unknown> = {
      skuIds: opts.skuIds.map((id) => String(id)).join(','),
      pid: this.buildPid(opts.positionId),
      ...(opts.subUnionId ? { subUnionId: opts.subUnionId } : {}),
    };
    const raw = await this.callJd(
      'jd.union.open.goods.promotiongoodsinfo.query',
      bizParams,
    );
    return extractJdResult<JdPromotionGoodsResult>(
      raw,
      'jd_union_open_goods_promotiongoodsinfo_query_responce',
      'getpromotiongoodsinfo_result',
    );
  }

  /**
   * 显式转链。Strategy=promotion_common 时 resolve 走这条。
   *
   * @param opts.materialId  商品落地页 URL,或单品的 item.jd.com 链接
   * @param opts.positionId  推广位 (默认 cfg.JDUNION_POSITION_ID)
   * @param opts.subUnionId  子渠道(per-agent 归因)
   * @param opts.ext1        扩展字段(我们透传 OCP entry_id)
   */
  async getPromotionCommonLink(opts: {
    materialId: string;
    positionId?: string;
    subUnionId?: string;
    ext1?: string;
    couponUrl?: string;
  }): Promise<NonNullable<JdPromotionCommonResult['data']>> {
    if (this.cfg.JDUNION_MOCK) {
      // mock: 用 materialId 算个稳定 hash 当短码,这样测试断言能命中固定 URL
      const hash = String(
        Math.abs(
          [...opts.materialId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0),
        ),
      ).slice(0, 8);
      return {
        clickURL: `https://union-click.jd.com/jdc?e=&p=mock_${hash}`,
        shortURL: `https://u.jd.com/mock_${hash}`,
      };
    }

    const siteId = this.resolveSiteId();
    const bizParams: JdPromotionCommonRequest = {
      materialId: opts.materialId,
      pid: this.buildPid(opts.positionId),
      ...(siteId ? { siteId } : {}),
      ...(opts.subUnionId ? { subUnionId: opts.subUnionId } : {}),
      ...(opts.ext1 ? { ext1: opts.ext1 } : {}),
      ...(opts.couponUrl ? { couponUrl: opts.couponUrl } : {}),
    };
    const raw = await this.callJd('jd.union.open.promotion.common.get', {
      promotionCodeReq: bizParams,
    });
    const result = extractJdResult<JdPromotionCommonResult>(
      raw,
      'jd_union_open_promotion_common_get_responce',
      'getResult',
    );
    return result.data ?? {};
  }

  /**
   * 行级订单 (佣金回流)。
   *
   * @param opts.type        1=按下单时间 2=按完成时间 3=按更新时间
   * @param opts.startTime   北京时间 'YYYY-MM-DD HH:mm:ss'
   * @param opts.endTime     北京时间
   * @param opts.pageNo      页码,从 1 开始
   * @param opts.pageSize    每页 (上限 500)
   */
  async listOrderRows(opts: {
    type: 1 | 2 | 3;
    startTime: string;
    endTime: string;
    pageNo: number;
    pageSize: number;
  }): Promise<JdOrderRowResult> {
    if (this.cfg.JDUNION_MOCK) {
      return loadOrderFixture();
    }

    const bizParams: Record<string, unknown> = {
      orderReq: {
        type: opts.type,
        startTime: opts.startTime,
        endTime: opts.endTime,
        pageNo: opts.pageNo,
        pageSize: opts.pageSize,
      },
    };
    const raw = await this.callJd('jd.union.open.order.row.query', bizParams);
    return extractJdResult<JdOrderRowResult>(
      raw,
      'jd_union_open_order_row_query_responce',
      'queryResult',
    );
  }

  /**
   * 内部:对 JD 网关发起带签名的 POST 请求。
   * 出错时(含网关错误响应)抛 JdApiError。
   *
   * @returns 原始 envelope (未拆 inner JSON);由调用方用 extractJdResult 取内层。
   */
  private async callJd(
    method: string,
    bizParams: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.cfg.JDUNION_APP_KEY || !this.cfg.JDUNION_APP_SECRET) {
      throw new Error(
        'JdUnionClient: real 模式但缺 AppKey/AppSecret (应已被 config 校验拦下)',
      );
    }

    // 业务参数序列化成一个 JSON 字符串,签名与发送用的是同一份 string
    const paramJson = JSON.stringify(bizParams);

    const sysParams: Record<string, string> = {
      method,
      app_key: this.cfg.JDUNION_APP_KEY,
      format: 'json',
      v: '1.0',
      sign_method: 'md5',
      timestamp: formatBeijingTimestamp(new Date()),
      '360buy_param_json': paramJson,
    };
    const signed: Record<string, string> = {
      ...sysParams,
      sign: jdSign(sysParams, this.cfg.JDUNION_APP_SECRET, 'md5'),
    };

    const res = await fetch(this.cfg.JDUNION_BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(signed).toString(),
      signal: AbortSignal.timeout(this.cfg.JDUNION_QUERY_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new JdApiError(
        `http_${res.status}`,
        `JD HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    if (isJdGatewayError(data)) {
      throw new JdApiError(
        data.error_response.sub_code ?? `code_${data.error_response.code}`,
        data.error_response.sub_msg ?? data.error_response.msg,
        data.error_response,
      );
    }
    return data;
  }
}
