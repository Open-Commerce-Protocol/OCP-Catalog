/**
 * 阿里妈妈淘宝联盟 API 的 TypeScript 类型（仅本服务用到的字段子集）。
 *
 * 参考接口：
 *   - taobao.tbk.dg.material.optional      旧版物料搜索
 *   - taobao.tbk.dg.material.optional.upgrade 新版物料搜索
 *   - taobao.tbk.privilege.get             单品券高效转链
 *   - taobao.tbk.order.get                 订单查询（暂未使用，预留）
 *
 * 设计原则：
 *   1. 严格映射真实响应结构，不做 camelCase 化（snake_case 保留）。
 *   2. 可选字段标 ? 而不是 string | undefined，更紧凑。
 *   3. 单值字段在响应中可能为 null —— 保留 | null。
 *   4. 数字字段（commission_rate / volume）真实 API 偶尔会返字符串，
 *      mapper 层负责兼容（这里类型按主流形态声明）。
 */

// ============================================================
// 通用：错误响应
// ============================================================

/** 阿里 top 网关错误响应 */
export interface AlimamaErrorResponse {
  error_response: {
    code: number;
    msg: string;
    sub_code?: string; // 如 "isv.access-limit"、"isv.invalid-parameter-adzone"
    sub_msg?: string;
    request_id?: string;
  };
}

// ============================================================
// material.optional：物料搜索
// ============================================================

/** material.optional 返回的单个商品 */
export interface AlimamaMaterialItem {
  /** 商品 ID。新版接口可能返回加密/混淆后的字符串 item_id。 */
  num_iid: number | string;

  /** 商品标题 */
  title: string;

  /** 主图 URL。注意：常以 `//gw.alicdn.com/...` 形式返回（无 scheme），需 mapper 绝对化 */
  pict_url: string;

  /** 副图。top 风格："包了一层"为 { string: string[] }，可能为 null 或字段缺失 */
  small_images?: { string: string[] } | null;

  /** 商品页 URL（非 affiliate） */
  item_url: string;

  /** 一口价（吊牌价），字符串形如 "299.00" */
  reserve_price: string;

  /** 折扣价（当前售价），字符串形如 "199.00" */
  zk_final_price: string;

  /**
   * 卖家类型：0 = 淘宝，1 = 天猫
   * 注：类型声明为 number 而非 0 | 1 字面量，因为 TS 从 JSON import
   * 推断不出字面类型。Mapper 用 `=== 1` 判断即可。
   */
  user_type: number;

  // ---- 以下字段为可选 / 真实 API 中常缺失 ----

  /** 店铺名 */
  shop_title?: string;

  /** 卖家 ID */
  seller_id?: number;

  /** 类目 ID（数字） */
  category_id?: number;

  /** 类目（字符串形式，部分接口版本会返） */
  cat?: string;

  /** 30 天销量 */
  volume?: number;

  /**
   * 佣金率，基点单位（1550 = 15.5%）
   * 主流形态是 number，少数情况返字符串；mapper 兼容处理
   */
  commission_rate?: number | string;

  /** 淘客 30 天销量（字符串） */
  tk_total_sales?: string;

  /** 淘客 30 天累计佣金（字符串，单位元） */
  tk_total_commi?: string;

  // ---- 优惠券字段（无券时全部缺失） ----

  coupon_id?: number;

  /** 券描述文案，如 "满 199 元减 50 元" */
  coupon_info?: string | null;

  /** 券有效期开始（"YYYY-MM-DD"） */
  coupon_start_time?: string | null;

  /** 券有效期结束 */
  coupon_end_time?: string | null;

  /** 券总数量 */
  coupon_total_count?: number | null;

  /** 券剩余数量 */
  coupon_remain_count?: number | null;
}

/** material.optional 整体响应 */
export interface AlimamaMaterialResponse {
  tbk_dg_material_optional_response: {
    total_results: number;
    result_list: {
      map_data: AlimamaMaterialItem[];
    };
  };
}

// ============================================================
// privilege.get：转链
// ============================================================

/** privilege.get 返回的转链数据 */
export interface AlimamaPrivilegeData {
  /** ★ 核心字段：带 PID 的券领取/购买短链，形如 https://s.click.taobao.com/xxx */
  coupon_click_url?: string;

  /** 商品深链（带 PID 但不带券） */
  item_url?: string;

  /** 券文案 */
  coupon_info?: string;

  /** 券有效期 */
  coupon_end_time?: string;

  /** 券开始时间 */
  coupon_start_time?: string;

  /** 最大佣金率（字符串形式，如 "1550"） */
  max_commission_rate?: string;

  /** 商品类目 */
  category_id?: number;

  // ---- 阿里妈妈专属券（mm_*）---- 通常二选一使用
  mm_coupon_click_url?: string;
  mm_coupon_info?: string;
  mm_coupon_start_time?: string;
  mm_coupon_end_time?: string;
  mm_coupon_remain_count?: number;
  mm_coupon_total_count?: number;
}

/** privilege.get 整体响应 */
export interface AlimamaPrivilegeResponse {
  tbk_privilege_get_response: {
    result: {
      data: AlimamaPrivilegeData;
    };
  };
}

// ============================================================
// order.get：订单查询（佣金回流）
// ============================================================

/**
 * 单个订单状态码（tk_status）：
 *   12 = 订单付款（用户已付款,佣金预估）
 *   13 = 订单成交/结算（确认收货后佣金到账）
 *   14 = 订单失效（取消/退款）
 *   15 = 维权中（佣金冻结）
 */
export type AlimamaOrderStatus = number;

export interface AlimamaOrder {
  /** 订单 ID（去重主键） */
  trade_id: string | number;
  /** 父订单（一单多商品时,多行共享一个 trade_parent_id） */
  trade_parent_id?: string | number;
  /** 商品 ID（关联到 material 的 num_iid） */
  item_id: number;
  /** 商品标题 */
  item_title?: string;
  /** 用户付款时间（"YYYY-MM-DD HH:mm:ss"） */
  tb_paid_time?: string;
  /** 淘客付款时间 */
  tk_paid_time?: string;
  /** 佣金到账时间（结算后才有） */
  tk_earning_time?: string;
  /** 用户实付金额（字符串元） */
  alipay_total_price?: string;
  /** 商品标价 */
  total_commission_fee?: string;
  /** 淘客预估佣金（字符串元） */
  pub_share_pre_fee?: string;
  /** 淘客实际佣金 */
  pub_share_fee?: string;
  /** 状态码 */
  tk_status: AlimamaOrderStatus;
  /** 推广位 ID（用于按 agent 归因） */
  adzone_id?: number;
  /** 媒体 ID */
  site_id?: number;
  /** Provider 在调 privilege.get 时传入的 external_id 透传回来 */
  click_time?: string;
  /** 数量 */
  item_num?: number;
  /** 卖家旺旺/Nick */
  seller_nick?: string;
  /** 终端类型 1 PC / 2 无线 */
  terminal_type?: number;
}

export interface AlimamaOrderResponse {
  tbk_order_get_response: {
    results: {
      n_tbk_order: AlimamaOrder[];
    };
    total_count?: number;
    request_id?: string;
  };
}

// ============================================================
// 联合：成功或失败
// ============================================================

/** Alimama API 任一调用的响应：要么是预期成功体，要么是错误响应 */
export type AlimamaApiResponse<T> = T | AlimamaErrorResponse;

/** type guard：判断是否为错误响应 */
export function isAlimamaError(res: unknown): res is AlimamaErrorResponse {
  return (
    typeof res === 'object' &&
    res !== null &&
    'error_response' in res &&
    typeof (res as AlimamaErrorResponse).error_response === 'object'
  );
}
