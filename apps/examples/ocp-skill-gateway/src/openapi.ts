/**
 * 给 Coze / 元器 / 百炼 / 文心 等平台导入用的 OpenAPI 3.0 spec。
 *
 * 只包含 `/skill/*` 路由,不暴露 dashboard / admin。
 * 手写 YAML 是有意的:各平台对 spec 的字段(operationId、tags、example)期望略有差异,
 * 写死能更精准控制,后续按平台微调也方便。
 */
import type { SkillGatewayConfig } from './config';

export function buildOpenApiYaml(cfg: SkillGatewayConfig): string {
  const server = cfg.SKILL_GATEWAY_PUBLIC_BASE_URL;
  return `openapi: 3.0.1
info:
  title: OCP Skill Gateway
  description: |
    把多家电商联盟(淘宝/京东/拼多多 等)聚合为统一的 LLM 工具。
    LLM 可以用 /skill/search 搜商品,用 /skill/deeplink 生成返佣购买链接。
  version: 0.1.0
servers:
  - url: ${server}
    description: Public Skill Gateway
components:
  securitySchemes:
    SkillKey:
      type: apiKey
      in: header
      name: X-Skill-Key
security:
  - SkillKey: []
paths:
  /skill/search:
    post:
      operationId: skill_search
      summary: 跨电商联盟搜索商品
      description: 用一句自然语言关键词搜索,跨所有已接入联盟并行返回扁平化结果。
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query:
                  type: string
                  description: 用户搜索关键词,如 "200 元以内的蓝牙耳机"
                page:
                  type: integer
                  minimum: 1
                  default: 1
                page_size:
                  type: integer
                  minimum: 1
                  maximum: 30
                  default: 10
      responses:
        '200':
          description: 搜索结果
          content:
            application/json:
              schema:
                type: object
                properties:
                  query: { type: string }
                  total: { type: integer }
                  items:
                    type: array
                    items:
                      type: object
                      properties:
                        title: { type: string }
                        price: { type: number }
                        currency: { type: string }
                        source: { type: string, description: 来源联盟名 }
                        image_url: { type: string }
                        detail_url: { type: string }
                        catalog_id: { type: string }
                        entry_ref: { type: string }
  /skill/deeplink:
    post:
      operationId: skill_deeplink
      summary: 生成带返佣的购买链接
      description: 把 search 结果中的某一项转成可点击的 deeplink。Agent 让用户点这个链接下单,佣金回流。
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [catalog_id, entry_ref]
              properties:
                catalog_id: { type: string }
                entry_ref: { type: string }
                sub_id:
                  type: string
                  description: 可选,子渠道 / Agent ID,用于归因
      responses:
        '200':
          description: 已生成 deeplink
          content:
            application/json:
              schema:
                type: object
                properties:
                  catalog_id: { type: string }
                  deeplink_url: { type: string }
                  short_url: { type: string }
  /skill/compare:
    post:
      operationId: skill_compare
      summary: 跨电商联盟比价
      description: 多家联盟搜同一商品并按价格升序返回。
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query: { type: string }
                per_source:
                  type: integer
                  minimum: 1
                  maximum: 10
                  default: 5
      responses:
        '200':
          description: 比价结果(items 已按 price 升序)
          content:
            application/json:
              schema:
                type: object
                properties:
                  query: { type: string }
                  items:
                    type: array
                    items:
                      type: object
                      properties:
                        title: { type: string }
                        price: { type: number }
                        currency: { type: string }
                        source: { type: string, description: 来源联盟名 }
                        detail_url: { type: string }
                        catalog_id: { type: string }
                        entry_ref: { type: string }
  /skill/recommend:
    post:
      operationId: skill_recommend
      summary: 按预算 / 类目推荐商品
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                query: { type: string }
                category: { type: string }
                budget_min: { type: number }
                budget_max: { type: number }
                limit:
                  type: integer
                  minimum: 1
                  maximum: 20
                  default: 5
      responses:
        '200':
          description: 推荐结果
          content:
            application/json:
              schema:
                type: object
                properties:
                  reason: { type: string, description: 推荐理由摘要 }
                  items:
                    type: array
                    items:
                      type: object
                      properties:
                        title: { type: string }
                        price: { type: number }
                        currency: { type: string }
                        source: { type: string, description: 来源联盟名 }
                        detail_url: { type: string }
                        catalog_id: { type: string }
                        entry_ref: { type: string }
  /skill/order:
    post:
      operationId: skill_order
      summary: 查询订单与佣金 (M2 未实现)
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                sub_id: { type: string }
                days:
                  type: integer
                  minimum: 1
                  maximum: 30
                  default: 7
      responses:
        '501':
          description: 当前未实现
`;
}
