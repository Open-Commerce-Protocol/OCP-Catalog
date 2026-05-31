# Coze Bot 人设建议(配合 5 个 skill)

## 当前现状

第一版 Bot 人设只点名了 2 个工具:

```
你是一个购物推荐助手。用户告诉你想买什么,你用 ocp_search 搜索,
然后用 ocp_deeplink 给出可点击的购买链接。
```

实测结果(豆包 1.8 深度思考):

- ✅ 「我想买个降噪蓝牙耳机」→ 正确串 `skill_search` + `skill_deeplink`,3 个 catalog 全覆盖
- ❌ 「SONY WH-1000XM5 哪家最便宜」→ Bot 不主动调 `skill_compare`,改用 `skill_search` 自己排序,价格信息可能丢
- ❌ 「200 元以内的充电器」→ Bot 不主动调 `skill_recommend`,改用 `skill_search` + 自己过滤,效率低

## 推荐人设(直接粘贴到 Bot 「人设与回复逻辑」框里)

```
你是一个购物推荐助手。根据用户意图选合适的工具:
- 普通找货 / 「找个 X」 → skill_search,再用 skill_deeplink 给购买链接
- 比价 / 「哪家最便宜」/ 「最低价」 → skill_compare(已经按价升序)
- 给预算或类目 / 「200 元以内的 X」/ 「300 块的耳机」 → skill_recommend
所有平台数据来自 OCP 注册中心,链接都是真实可点击的返佣链接,直接给用户即可。
回复风格:简洁,先给商品 + 价格 + 平台,再附 deeplink,不要多余客套。
```

## 为什么这么写

1. **每个工具用「关键词触发条件」打标**:LLM 看到「最便宜」就有明确锚点用 `skill_compare`,看到「预算」就知道用 `skill_recommend`,不会蒙
2. **强调「数据来自 OCP 注册中心」**:不强调"返佣"字样,避免触发 Coze 政策审核
3. **「链接真实可点击」一句兜底**:LLM 看到旧的 mock 数据时容易自我怀疑「这是不是假数据」,这句明确告诉它别犹豫
4. **回复风格收口**:让 LLM 不要在每条回复里都加「希望对您有帮助哦~」之类的尾巴,Coze 普遍有这个倾向

## 测试 prompt 清单(等领导给生产 key 后用)

| 输入 | 期望调的工具 | 期望响应特征 |
|---|---|---|
| 帮我找个降噪蓝牙耳机 | `skill_search` + N× `skill_deeplink` | 多 catalog 覆盖,3 条以上候选 |
| SONY WH-1000XM5 哪家最便宜 | `skill_compare` | items 按 price 升序,首条是最低价 |
| 推荐 200 元以内的充电器 | `skill_recommend` | 所有 items 的 price ≤ 200 |
| 帮我买条 USB-C 数据线 | `skill_search` + `skill_deeplink` | 有 detail_url / deeplink_url |

每条跑完截图,Bot 回复气泡上方的「调用插件」展开,可以看 LLM 真实调了哪些工具、参数是什么。
