/**
 * 京东联盟 (JD Union) API 的 TypeScript 类型 (仅本服务用到的字段子集)。
 *
 * 涉及的 4 个核心接口:
 *   - jd.union.open.goods.query                       物料/商品搜索
 *   - jd.union.open.goods.promotiongoodsinfo.query    批量取单品 + 推广信息(含 shortURL)
 *   - jd.union.open.promotion.common.get              显式转链(单条)
 *   - jd.union.open.order.row.query                   行级订单(佣金回流数据源)
 *
 * 设计原则 (与 alimama types 对齐):
 *   1. 严格映射真实响应结构,不做 camelCase / snake_case 改写
 *   2. 可选字段标 ?,而不是 string | undefined
 *   3. 单值字段可能为 null 时保留 | null
 *   4. 响应顶层 key 保留 JD 原样(部分接口存在拼写问题如 "responce" 不要改)
 *
 * ⚠️ 字段名以 JD 公开文档为准,首次跑通 mock fixture 前不假设取值;
 *    若真实响应字段名不符,只需修改本文件 + 对应 mapper,不影响 catalog 层。
 */

// ============================================================
// 通用:错误响应
// ============================================================

/**
 * JD 网关层错误 (与 alimama Top 同形)。
 * 内层业务错误(如 queryResult 里 code !== 200)由 client 层另做处理。
 */
export interface JdErrorResponse {
  error_response: {
    code: number;
    msg: string;
    sub_code?: string;
    sub_msg?: string;
    request_id?: string;
  };
}

// ============================================================
// 公共子结构
// ============================================================

/** 图片信息 */
export interface JdImageInfo {
  imageList?: Array<{ url: string }> | null;
  whiteImage?: string | null;
}

/** 价格信息 (number 类型,无需 parseFloat) */
export interface JdPriceInfo {
  /** 商品价 */
  price?: number;
  /** 最低价(可能等于 lowestCouponPrice) */
  lowestPrice?: number;
  /** 最低价类型: 1=无券价 2=有券价 */
  lowestPriceType?: number;
  /** 券后价 */
  lowestCouponPrice?: number;
}

/** 佣金信息 */
export interface JdCommissionInfo {
  /** 佣金率 (百分数,如 5.0 表示 5%) */
  commissionShare?: number;
  /** 预估佣金额(元) */
  commission?: number;
  /** 佣金类型 (1=自营 2=POP 等) */
  couponCommission?: number;
}

/** 店铺信息 */
export interface JdShopInfo {
  shopId?: number;
  shopName?: string;
  shopLevel?: number;
}

/** 类目信息 */
export interface JdCategoryInfo {
  cid1?: number;
  cid2?: number;
  cid3?: number;
  cid1Name?: string;
  cid2Name?: string;
  cid3Name?: string;
}

/** 券信息 */
export interface JdCouponInfo {
  couponList?: Array<{
    /** 券面额 */
    discount?: number;
    /** 券种类: 0=店铺券 1=商品券 */
    couponKind?: number;
    /** 券链接 */
    link?: string;
    /** 满减门槛 */
    quota?: number;
    /** 券类型: 1=优惠券 ... */
    platformType?: number;
    getStartTime?: number;
    getEndTime?: number;
    useStartTime?: number;
    useEndTime?: number;
    /** 是否最优券 */
    isBest?: number;
  }> | null;
}

// ============================================================
// jd.union.open.goods.query - 商品物料搜索
// ============================================================

/** goods.query 单条商品 */
export interface JdGoodsItem {
  /** SKU 编号(主键) */
  skuId: number;
  /** 商品标题 */
  skuName: string;
  /** 图片信息 */
  imageInfo?: JdImageInfo;
  /** 价格 */
  priceInfo?: JdPriceInfo;
  /** 佣金 */
  commissionInfo?: JdCommissionInfo;
  /** 店铺 */
  shopInfo?: JdShopInfo;
  /** 类目 */
  categoryInfo?: JdCategoryInfo;
  /** 券 */
  couponInfo?: JdCouponInfo;
  /** 商品落地页 URL (非 affiliate) */
  materialUrl?: string;
  /** 30 天累计销量 */
  inOrderCount30Days?: number;
  /** 30 天累计销量(去重) */
  inOrderCount30DaysSku?: number;
  /** 商品来源: 1=自营 2=POP */
  owner?: string;
  /** 品牌名 */
  brandName?: string;
  /** 品牌 ID */
  brandCode?: string;
}

/** goods.query 内层结果(queryResult JSON 字符串解析后) */
export interface JdGoodsQueryResult {
  code: number;
  message?: string;
  requestId?: string;
  totalCount?: number;
  data?: JdGoodsItem[];
  hasMore?: boolean;
}

/**
 * goods.query 顶层响应。
 * 注意: JD API 真实响应里 key 含拼写问题 "responce" (而非 response),按原样保留。
 */
export interface JdGoodsQueryResponse {
  jd_union_open_goods_query_responce: {
    code: string;
    /** 实际结果是一个 JSON 字符串,需由 client 层 JSON.parse 成 JdGoodsQueryResult */
    queryResult?: string;
    /** 某些版本字段名是 result */
    result?: string;
  };
}

// ============================================================
// jd.union.open.goods.promotiongoodsinfo.query
//   批量取单品 + 推广信息 (核心:resolve 时拿 affiliate shortURL)
// ============================================================

export interface JdPromotionGoodsItem {
  skuId: number;
  goodsName?: string;
  imgUrl?: string;
  /** 无券价 */
  unitPrice?: number;
  /** 券后价 */
  unitPriceLow?: number;
  /** 佣金率 (百分数) */
  commisionRatioWl?: number;
  /** 商品类型 */
  isHot?: number;
  /** 商品落地页(非 affiliate) */
  materialUrl?: string;
  /** ★ affiliate 长链(带 unionId+positionId 归因) */
  clickURL?: string;
  /** ★ affiliate 短链(u.jd.com/xxx,带归因) */
  shortURL?: string;
  /** 券链接 affiliate 化版本 */
  couponLink?: string;
  /** 店铺名 */
  shopName?: string;
  /** 一级类目名 */
  cidName?: string;
  /** 30 天销量 */
  inOrderCount30Days?: number;
}

export interface JdPromotionGoodsResult {
  code: number;
  message?: string;
  requestId?: string;
  result?: JdPromotionGoodsItem[];
}

export interface JdPromotionGoodsResponse {
  jd_union_open_goods_promotiongoodsinfo_query_responce: {
    code: string;
    /** JSON 字符串 → JdPromotionGoodsResult */
    getpromotiongoodsinfo_result?: string;
  };
}

// ============================================================
// jd.union.open.promotion.common.get - 通用转链
// ============================================================

export interface JdPromotionCommonResult {
  code: number;
  message?: string;
  requestId?: string;
  data?: {
    /** 长链 (推广链接) */
    clickURL?: string;
    /** 短链 (u.jd.com/xxx) */
    shortURL?: string;
    /** 唤起手 Q / 京东 App 协议链接(可选) */
    jCommand?: string;
  };
}

export interface JdPromotionCommonResponse {
  jd_union_open_promotion_common_get_responce: {
    code: string;
    /** JSON 字符串 → JdPromotionCommonResult */
    getResult?: string;
  };
}

/** 显式转链请求参数 (业务参数,客户端会包成 360buy_param_json) */
export interface JdPromotionCommonRequest {
  /** 商品落地页 URL (商品 url 或 京粉粒度的 link) */
  materialId: string;
  /** 推广位 ID */
  positionId?: number;
  /** 联盟 ID + 推广位 (PID 形式: unionId_positionId 或工具商 unionId_mediaId_positionId) */
  pid?: string;
  /** siteId,工具商账号必填(否则 1002024 "siteId不能为空") */
  siteId?: string;
  /** 渠道标识(可选,通常用于自定义业务) */
  subUnionId?: string;
  /** 扩展字段 (用于按 Agent 透传) */
  ext1?: string;
  /** 优惠券链接(把券链接转成推广链接) */
  couponUrl?: string;
}

// ============================================================
// jd.union.open.order.row.query - 行级订单 (佣金回流)
// ============================================================

/**
 * 订单 validCode 状态码 (常用集):
 *   15 = 有效 (订单创建,佣金预估)
 *   16 = 完成 (用户已收货 + 结算)
 *   17 = 已退款 / 无效
 *   其他状态 (2/3) 见 JD 文档
 */
export type JdOrderValidCode = number;

export interface JdOrderRow {
  /** 订单行 ID(单订单一商品一条) */
  id?: number | string;
  /** 父订单号 */
  parentId?: number | string;
  /** SKU */
  skuId: number;
  /** 商品名 */
  skuName?: string;
  /** 商品数量 */
  skuNum?: number;
  /** 商品实付金额(元) */
  skuFrozenNum?: number;
  /** 实际付款金额 (元,price * num) */
  estimateCosPrice?: number;
  /** 预估佣金(元) */
  estimateFee?: number;
  /** 实际付款金额(结算后,元) */
  actualCosPrice?: number;
  /** 实际佣金(元,结算后才有) */
  actualFee?: number;
  /** 佣金率 (百分数) */
  commissionRate?: number;
  /** 订单完成时间 (unix 毫秒) */
  finishTime?: number;
  /** 用户下单时间 (unix 毫秒) */
  orderTime?: number;
  /** 订单更新时间 (unix 毫秒) */
  modifyTime?: number;
  /** 结算时间 (unix 毫秒) */
  payMonth?: number;
  /** 订单当前状态码 */
  validCode: JdOrderValidCode;
  /** 推广位 ID */
  positionId?: number;
  /** 联盟 ID */
  unionId?: number;
  /** 渠道标识(我们透传过去的 Agent 归因 key) */
  subUnionId?: string;
  /** 自定义扩展字段(我们传 OCP entry_id) */
  ext1?: string;
  /** 商品所属一级类目 */
  cid1?: number;
  /** 子站点 site_id */
  siteId?: number;
}

export interface JdOrderRowResult {
  code: number;
  message?: string;
  requestId?: string;
  data?: JdOrderRow[];
  hasMore?: boolean;
}

export interface JdOrderRowResponse {
  jd_union_open_order_row_query_responce: {
    code: string;
    /** JSON 字符串 → JdOrderRowResult */
    queryResult?: string;
  };
}

// ============================================================
// 联合: 成功或失败
// ============================================================

export type JdApiResponse<T> = T | JdErrorResponse;

/** type guard: 是否为网关错误响应 */
export function isJdGatewayError(res: unknown): res is JdErrorResponse {
  return (
    typeof res === 'object' &&
    res !== null &&
    'error_response' in res &&
    typeof (res as JdErrorResponse).error_response === 'object'
  );
}
