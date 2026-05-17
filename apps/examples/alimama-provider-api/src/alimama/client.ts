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

    return this.callTop<AlimamaMaterialResponse>('taobao.tbk.dg.material.optional', {
      ...(opts.q ? { q: opts.q } : {}),
      ...(opts.cat ? { cat: opts.cat } : {}),
      page_no: String(opts.pageNo),
      page_size: String(opts.pageSize),
      adzone_id: opts.adzoneId ?? this.cfg.ALIMAMA_ADZONE_ID,
    });
  }

  /**
   * 转链 (核心动作:Agent resolve 时调用此方法拿带 PID 的短链)。
   * @param opts.itemId      商品 num_iid
   * @param opts.adzoneId    推广位 ID,决定佣金归到哪
   * @param opts.externalId  外部业务 ID,会出现在订单回执（用于 OCP entry_id 归因）
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
