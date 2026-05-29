/**
 * 拼多多 (PDD) 多多客 / 多多进宝 API 的 TypeScript 类型 (仅本服务用到的字段子集)。
 *
 * 涉及的 4 个核心接口:
 *   - pdd.ddk.goods.search                     物料/商品搜索
 *   - pdd.ddk.goods.detail                     单品详情 (Resolve 备选路径)
 *   - pdd.ddk.goods.promotion.url.generate     转链 (Resolve 默认路径)
 *   - pdd.ddk.order.list.range.get             订单查询 (佣金回流数据源)
 *
 * 设计原则 (与 alimama / JD types 对齐):
 *   1. 严格映射真实响应结构,不做 camelCase / snake_case 改写
 *   2. 可选字段标 ?,而不是 string | undefined
 *   3. 单值字段可能为 null 时保留 | null
 *
 * ⚠️ PDD 价格字段是 **整数,单位分** (1990 = ¥19.90),不是 alimama / JD 的元单位。
 *     mapper 层必须 /100 转成元,这是 PDD 比 alimama / JD 最显著的字段差异。
 *
 * ⚠️ PDD 时间字段是 **Unix 秒** (1716040000),不是 alimama 的 'YYYY-MM-DD HH:mm:ss'
 *     字符串,也不是 JD 的 unix 毫秒。
 */

// ============================================================
// 通用:错误响应
// ============================================================

/** PDD 网关错误响应 */
export interface PddErrorResponse {
  error_response: {
    error_code: number;
    error_msg: string;
    sub_code?: string;
    sub_msg?: string;
    request_id?: string;
  };
}

// ============================================================
// pdd.ddk.goods.search - 物料搜索
// ============================================================

/** goods.search 单条商品 */
export interface PddGoodsItem {
  /** 商品 ID (PDD goods_id,通常 < MAX_SAFE_INTEGER 但要谨慎处理) */
  goods_id: number;
  /** 商品签名 (新 API 推荐用 goods_sign 替代 goods_id 做单品引用) */
  goods_sign?: string;
  /** 商品标题 */
  goods_name: string;
  /** 商品缩略图 (主图) */
  goods_thumbnail_url?: string;
  /** 商品主图 (大图) */
  goods_image_url?: string;
  /** 轮播图 */
  goods_gallery_urls?: string[];
  /** 商品详情图 */
  goods_desc?: string;

  // ---- 价格 (单位:分 / cents,需 /100 转元) ----
  /** 拼团最低价 (券后价,单位分) */
  min_group_price?: number;
  /** 单买最低价 (单位分) */
  min_normal_price?: number;

  // ---- 佣金 (单位:千分位 / per mille) ----
  /** 佣金比例 (千分位,如 50 = 5.0%) */
  promotion_rate?: number;

  // ---- 类目 ----
  cat_id?: number;
  cat_name?: string;
  category_id?: number;
  category_name?: string;

  // ---- 店铺 ----
  mall_id?: number;
  mall_name?: string;
  /** 商家类型: 1=个人店 2=企业店 3=旗舰店 4=专卖店 5=专营店 */
  merchant_type?: number;

  // ---- 券 ----
  /** 是否有券 */
  has_coupon?: boolean;
  /** 券面额 (单位分) */
  coupon_discount?: number;
  /** 券门槛 (单位分) */
  coupon_min_order_amount?: number;
  /** 券领取起始时间 (Unix 秒) */
  coupon_start_time?: number;
  /** 券有效期截止 (Unix 秒) */
  coupon_end_time?: number;
  /** 券剩余数量 */
  coupon_remain_quantity?: number;
  /** 券总数 */
  coupon_total_quantity?: number;

  // ---- 销量 / 评分 ----
  /** 销量(数字,如 100000) */
  sold_quantity?: number;
  /** 销量描述(字符串,如 "10万+") */
  sales_tip?: string;
  /** 历史推广量 (推客视角的销量) */
  hist_sold_quantity?: number;
  /** 服务标签 (如 "已加入百亿补贴"、"补贴现价" 等) */
  service_tags?: number[];

  // ---- 品牌 ----
  brand_name?: string;
  brand_logo?: string;
}

/** goods.search 内层结果 */
export interface PddGoodsSearchResult {
  /** 单页商品列表 */
  goods_list?: PddGoodsItem[];
  /** 总数(部分场景下 PDD 不返回准确总数) */
  total_count?: number;
  /** 翻页用的 list_id(部分接口要求带回) */
  list_id?: string;
  /** 搜索 id */
  search_id?: string;
}

/**
 * goods.search 顶层响应。
 * PDD 响应外层包一层 `goods_search_response`,内层 **直接是对象**(不是 JSON 字符串,与 JD 不同)。
 */
export interface PddGoodsSearchResponse {
  goods_search_response: PddGoodsSearchResult;
}

// ============================================================
// pdd.ddk.goods.detail - 单品详情
// ============================================================

export interface PddGoodsDetailResult {
  goods_details?: PddGoodsItem[];
}

export interface PddGoodsDetailResponse {
  goods_detail_response: PddGoodsDetailResult;
}

// ============================================================
// pdd.ddk.goods.promotion.url.generate - 转链 (核心)
// ============================================================

/** 单条转链结果 */
export interface PddPromotionUrlItem {
  /** affiliate 长链 (mobile.yangkeduo.com/...) */
  url?: string;
  /** affiliate 短链 (p.pinduoduo.com/xxx) */
  short_url?: string;
  /** 微信小程序内嵌 webview 链接 */
  we_app_web_view_url?: string;
  /** 微信小程序短链 */
  we_app_web_view_short_url?: string;
  /** QQ 小程序内嵌 webview 链接 */
  qq_app_web_view_url?: string;
  /** QQ 小程序短链 */
  qq_app_web_view_short_url?: string;
  /** 唤起拼多多 App 的协议链接 */
  schema_url?: string;
  /** 多多客平台二维码 */
  qr_code_url?: string;
  /** 双 11 / 大促等场景的 mobile 链接 */
  mobile_url?: string;
  /** 双 11 / 大促等场景的 mobile 短链 */
  mobile_short_url?: string;
}

export interface PddPromotionUrlResult {
  goods_promotion_url_list?: PddPromotionUrlItem[];
  /** 单品券链接 (有券时返回) */
  url_list?: string[];
}

export interface PddPromotionUrlResponse {
  goods_promotion_url_generate_response: PddPromotionUrlResult;
}

/** 转链请求参数 (业务参数,客户端会扁平拼接) */
export interface PddPromotionUrlRequest {
  /** 推广位 PID */
  p_id: string;
  /** 商品 ID 列表(JSON 字符串数组,如 "[123,456]") */
  goods_id_list?: string;
  /** 商品 sign 列表(新 API 推荐) */
  goods_sign_list?: string;
  /**
   * 自定义参数,JSON 字符串(URL-encoded)。
   * 形如: {"uid":"agt_demo","sid":"entry_pdd_xxx"}
   * 订单回流时原样回显在 order.custom_parameters 字段,用作 per-Agent / per-Entry 归因。
   */
  custom_parameters?: string;
  /** 是否生成 schema 链接(唤起 App) */
  generate_schema_url?: boolean;
  /** 是否生成短链 */
  generate_short_url?: boolean;
  /** 是否生成微信小程序短链 */
  generate_we_app?: boolean;
  /** 是否生成 QQ 小程序短链 */
  generate_qq_app?: boolean;
  /** 是否生成 mobile 短链 */
  generate_mobile?: boolean;
}

// ============================================================
// pdd.ddk.order.list.range.get - 行级订单 (佣金回流)
// ============================================================

/**
 * 订单 order_status 状态码 (PDD 比 alimama / JD 更细,8 档):
 *   0  = 已下单
 *   1  = 已支付
 *   2  = 已成团
 *   3  = 已确认收货
 *   4  = 审核成功
 *   5  = 审核失败 (无效订单)
 *   8  = 已结算
 *   10 = 已处罚 (违规扣回)
 *
 * mapper 将其合并为 5 档 LedgerOrderStatus,详见 mapper/order-to-ledger.ts。
 */
export type PddOrderStatus = number;

export interface PddOrderItem {
  /** 订单号 (PDD 唯一主键,字符串形式,长度安全) */
  order_sn: string;
  /** 商品 ID */
  goods_id: number;
  /** 商品名 */
  goods_name?: string;
  /** 商品数量 */
  goods_quantity?: number;
  /** 商品缩略图 */
  goods_thumbnail_url?: string;
  /** 商品分类 ID */
  cat_ids?: number[];

  // ---- 金额 (单位:分) ----
  /** 订单金额 */
  order_amount?: number;
  /** 预估佣金 */
  promotion_amount?: number;
  /** 服务费金额 (PDD 平台从佣金中扣的部分) */
  service_amount?: number;
  /** 实际到手佣金 = promotion_amount - service_amount */
  share_amount?: number;
  /** 单品总价 (= goods_price * goods_quantity) */
  goods_price?: number;

  // ---- 佣金率 (千分位) ----
  promotion_rate?: number;

  // ---- 状态与时间 (Unix 秒) ----
  order_status: PddOrderStatus;
  order_status_desc?: string;
  /** 下单时间 */
  order_create_time?: number;
  /** 支付时间 */
  order_pay_time?: number;
  /** 成团时间 */
  order_group_success_time?: number;
  /** 确认收货时间 */
  order_receive_time?: number;
  /** 审核时间 */
  order_verify_time?: number;
  /** 结算时间 */
  order_settle_time?: number;
  /** 最后更新时间 (用作增量同步) */
  order_modify_at?: number;

  // ---- 归因 ----
  /** 推广位 PID,形如 "26829999_278234567" */
  p_id?: string;
  /**
   * 自定义参数,JSON 字符串。
   * 我们转链时塞了 {uid, sid},订单回流时这里原样回显。
   * mapper 会 JSON.parse 出来,uid → agentExternalId,sid → externalId(OCP entry_id)。
   */
  custom_parameters?: string;

  /** 订单类型: 1=领券订单 2=直接购买 */
  type?: number;
  /** 是否为预售订单 */
  is_pre_sale?: number;
}

export interface PddOrderListResult {
  order_list?: PddOrderItem[];
  total_count?: number;
  /** 翻页用的最大订单 ID */
  last_order_id?: string;
  request_id?: string;
}

export interface PddOrderListResponse {
  order_list_get_response: PddOrderListResult;
}

// ============================================================
// 联合: 成功或失败
// ============================================================

export type PddApiResponse<T> = T | PddErrorResponse;

/** type guard: 是否为网关错误响应 */
export function isPddError(res: unknown): res is PddErrorResponse {
  return (
    typeof res === 'object' &&
    res !== null &&
    'error_response' in res &&
    typeof (res as PddErrorResponse).error_response === 'object'
  );
}
