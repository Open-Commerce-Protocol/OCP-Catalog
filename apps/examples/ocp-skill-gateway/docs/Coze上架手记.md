# Coze(扣子) 试上架手记

> 把 OCP Skill Gateway 的 5 个 skill 作为「插件」上架到扣子开发者平台,
> 让用户在「扣子智能体」里挂这个插件后,就能用自然语言搜商品 / 生成购买链接。
>
> 本文档是**操作过程的真实流水账**,记录每一步、每个坑、每个意外字段。

## 本次环境

| 项 | 值 |
|---|---|
| 公网 URL | `https://astrology-reserved-elizabeth-risks.trycloudflare.com` |
| OpenAPI URL | `<公网 URL>/openapi.yaml` |
| 鉴权方式 | API Key,Header `X-Skill-Key`,值 `sk_dev_demo_001` |
| 上架平台 | 扣子(国内版,https://www.coze.cn) |
| 操作日期 | 2026-05-26 |

## 操作步骤(给操作者用)

### Step 1 — 登录扣子开发者后台

1. 浏览器打开 https://www.coze.cn
2. 用手机号 / 抖音账号登录(国内版要实名认证)
3. 进入「个人空间」→ 顶部 tab 选「插件」

### Step 2 — 创建插件

1. 点「+ 创建插件」
2. 填:
   - 插件名称:`OCP 跨平台商品搜索`
   - 描述:`聚合淘宝/京东/拼多多 等电商联盟,用一句话搜全网商品,生成带返佣链接`
   - 插件 icon:暂时随便选一个
3. 「插件创建方式」选 **「云侧插件 - 基于已有服务创建」**(关键!不是「IDE 创建」)
4. 「插件 URL」填:**(暂留空,下一步填)**
5. 「鉴权方式」选 **「Service」**(服务级鉴权,LLM 全局共用一个 key)
   - **Location**: Header
   - **Parameter name**: `X-Skill-Key`
   - **Service Token / Service Key**: `sk_dev_demo_001`

> ⚠️ 这里的字段名扣子在不同版本里可能微调,操作时记下实际的字段名,补回本文档。

### Step 3 — 导入 OpenAPI

扣子的「云侧插件」一般有两种填法:

- **方式 A: 粘贴 OpenAPI**(推荐第一次用,可控)
  1. 浏览器访问 `<公网 URL>/openapi.yaml`
  2. 全选复制 YAML 内容
  3. 粘贴到扣子「IDL 内容」框

- **方式 B: 给 URL 让扣子拉取**(看扣子支不支持远程 URL)
  - 直接填 `<公网 URL>/openapi.yaml`

不管哪种,扣子会自动解析出 5 个工具:
`skill_search`, `skill_deeplink`, `skill_compare`, `skill_recommend`, `skill_order`

### Step 4 — 工具描述微调(关键!LLM 靠这个选工具)

扣子允许给每个工具调描述。我们的 OpenAPI 里写的 `summary` / `description` 是给 LLM 看的,
如果扣子说某个工具「描述不够清晰」,在扣子界面里改成更白话的版本即可。

参考写法(给 LLM 看的口语化描述):

| 工具 | 描述 |
|---|---|
| `skill_search` | 跨电商联盟搜索商品。用户说「找蓝牙耳机」就用这个 |
| `skill_deeplink` | 把搜索结果中某一项变成可点击的购买链接,带返佣 |
| `skill_compare` | 用户问「这个东西哪家最便宜」时,用这个看价格对比 |
| `skill_recommend` | 用户给预算时(「300 块以下的耳机」),用这个 |
| `skill_order` | (M2 才有,现在会返回 501,先在扣子隐藏这个 tool) |

### Step 5 — 调试

扣子有一个内置的「测试」按钮。每个工具都试一遍:

#### `skill_search`
- 入参:`{ "query": "蓝牙耳机", "page_size": 3 }`
- 期望:返回 9 条商品(每个 catalog 3 条),按 `JD Union / PDD / Alimama` 分布

#### `skill_deeplink`
- 入参(用上一步返回的 entry_ref):
  ```json
  { "catalog_id": "cat_jdunion", "entry_ref": "entry_jdunion_100012345678" }
  ```
- 期望:返回 `deeplink_url: "https://u.jd.com/mock_sony_xm5"`

#### `skill_compare`
- 入参:`{ "query": "耳机", "page_size": 5 }`
- 期望:5 条,按 price 升序

#### `skill_recommend`
- 入参:`{ "query": "充电器", "budget_max": 200 }`
- 期望:全部价格 ≤ 200

#### `skill_order`
- M2 才有,会返回 501。要么先在扣子隐藏,要么留着等 M2

### Step 6 — 创建一个测试 Agent 挂这个插件

1. 扣子顶部 tab → 「Bots」/「智能体」→ 「+ 创建」
2. 填一个 Bot 名:`OCP 购物助手 - 测试`
3. 人设(prompt):
   ```
   你是一个购物推荐助手。用户告诉你想买什么,你用 ocp_search 搜索,
   然后用 ocp_deeplink 给出可点击的购买链接。
   ```
4. 「插件」区域 → 添加 → 选刚才创建的「OCP 跨平台商品搜索」
5. 在右侧聊天框测试:
   - 问:「帮我找个降噪蓝牙耳机」→ 期望 Bot 调 `skill_search`,返回商品 + deeplink
   - 问:「200 元以内的充电器」→ 期望 Bot 调 `skill_recommend`

### Step 7 — (可选) 发布

如果只是内部演示,**先不发布**,Bot 设置成「仅自己可用」即可。
如果要分享给学生 / 同学测试,就发布到「商店」前先把 `SKILL_GATEWAY_API_KEYS` 改成有效期短的 key,
防止 quick tunnel URL 变化导致已发布的 Bot 调用挂掉。

---

## 操作中遇到的具体问题(实操记录)

### Q1: 扣子界面里「插件创建方式」的选项叫什么?

- 答:字段名叫 **「类型」**。
- 两个选项:
  - **「云侧插件 - 基于已有服务创建」**(我们用的这个,适合已经有 HTTP 服务 + OpenAPI 的情况)
  - **「云侧插件 - 在 Coze IDE 中创建」**(在扣子里现写代码,不适合我们)

### Q2: API Key 鉴权字段叫 Service Key 还是 Token?

- 答:扣子的鉴权区分两层。
- **第一层「授权方式」**:选 `Service`(代表服务级 / 全局共享,LLM 全局走同一个 key)。另一个是 `OAuth`,需要回调地址,不适合 API Key 场景。
- **第二层「Service 类型」**:出现两个选项,选 **`Service Token / API Key`**。
- 选完后下面冒出 3 个字段一起填:
  - **参数位置**:`Header`(不选 Query,Query 会进日志)
  - **Parameter Name**:`X-Skill-Key`
  - **Service token / API key**:`sk_dev_demo_001`(和 gateway 启动时 `SKILL_GATEWAY_API_KEYS` 必须完全一致)

### Q3: 导入 OpenAPI 时扣子有没有报字段不识别 / schema 不规范?

- 答:**没有报错**。粘贴 YAML 后扣子直接解析出 5 个 operation:`skill_search` / `skill_deeplink` / `skill_compare` / `skill_recommend` / `skill_order`,工具列表全显示。
- 注意点:在生成 spec 前必须先把 gateway 的 `SKILL_GATEWAY_PUBLIC_BASE_URL` 改成 tunnel URL,否则 `servers.url` 会指向 `localhost`,扣子在调用时会拒绝(只能调公网)。

### Q4: 测试调用时,有没有遇到 CORS / 403 / 超时?

- 答:**没有 CORS / 403 / 超时**。
- 唯一标红的是 `skill_order` 返回 **501 not_implemented** —— 这是我们后端 M1 占位的设计,扣子把任何非 2xx 标红"调试未通过",但这是预期行为,不是 bug。M2 接订单回流后会变绿。
- **schema 显示坑(已修复)**:刚导入时 `skill_compare` / `skill_recommend` 在扣子调试页左栏显示 `{}` 空对象,因为 OpenAPI 的 `responses.200.schema` 只写了 `type: object` 没列 properties。Raw Response 里数据是完整的。**已在 [openapi.ts](../src/openapi.ts) 中给这两个补全 schema(items[].title/price/currency/source/...),重新发布插件后两栏数据一致。**

### Q5: LLM 在 Bot 里实际调用时,有没有调错工具 / 漏字段?

- 答:**没漏字段。调用准确度很高。**
- 模型:豆包 1.8 深度思考
- 测试 prompt:「我想买个降噪蓝牙耳机」
- 实际行为:Bot 自动完成 **4 次工具调用**(1 次 search + 3 次 deeplink,每个 catalog 各一次),137 秒内返回 3 个候选商品,每条都带:
  - 商品标题(SONY WH-1000XM5 / Tmall 真无线 等)
  - 价格(2499 / 199 元)
  - 平台来源(JD Union / Alimama / PDD 完整覆盖)
  - **可点击 deeplink URL**(`u.jd.com/...`、`s.click.taobao.com/...`、`p.pinduoduo.com/...`)
- 关键结论:**即便 compare / recommend 的 OpenAPI response schema 偏松,LLM 也能从 raw response 完整抽取字段** —— 说明扣子在传递工具结果给 LLM 时用的是 raw body,不按 schema 过滤。但仍建议把 schema 补全(已修),为 ChatGPT GPT Actions 等更严格平台铺路。

---

## 已知风险(开始前预判)

| 风险 | 概率 | 缓解 |
|---|---|---|
| 扣子对「返佣 / 购物链接」类工具有政策限制 | 中 | 描述里强调「为信息检索 / 比价目的」,不强调佣金 |
| `*.trycloudflare.com` 不被扣子白名单接受 | 低 | 如出现,升级到 cloudflare named tunnel + 自有域名 |
| OpenAPI 3.0.1 扣子只认 3.0.x 主版本 | 低 | 我们用的就是 3.0.1,无问题 |
| 5 个工具同时导入,扣子是否会限制个数 | 低 | 个人开发者通常允许 ≥10 个,5 个绰绰有余 |
| `description` 含中文,扣子的 OpenAPI 解析器是否支持 UTF-8 | 极低 | 国内平台,大概率支持 |

---

## 复盘

- 上架到「可测试」用了约 **30 分钟**(含登录、填表、导入 OpenAPI、调试 5 个工具、发布、挂 Bot、写 prompt)。
- 测试 5 个工具,**通过 4 个,失败 1 个**(`skill_order` 按设计返回 501,不算 bug,M2 占位)。
- **首次 Bot 端到端调用**:豆包 1.8 + `我想买个降噪蓝牙耳机` → 137 秒内自动完成 4 次工具链(1 次 search × 3 catalog + 3 次 deeplink),3 个候选商品全带价格 + 平台 + 可点击链接,JD Union / Alimama / PDD 全覆盖。

### 关键 takeaway

1. **扣子的「调试通过」不等于"响应正确"**:调试页左栏按 OpenAPI response schema 过滤展示,如果 schema 只写 `type: object` 没列 properties,会显示空 `{}`。但 Raw Response 是完整的,LLM 也拿得到完整数据。**结论:别用左栏判定数据正确,看 Raw Response。**
2. **OpenAPI response schema 仍然必须写全**:虽然扣子不强制,但 ChatGPT GPT Actions / OpenAI Assistants 是 schema-strict 的。建议一开始就把 items[] 的每个字段都列清楚。
3. **`SKILL_GATEWAY_PUBLIC_BASE_URL` 是隐形坑**:env 没设的话 spec 的 `servers.url` 默认是 `localhost:4330`,扣子拒调用。一定要先起 tunnel → 拿到 URL → 重启 gateway → 再生成 spec → 再去扣子导入,顺序错一步就要返工。
4. **`skill_order` 这种 501 占位最好默认禁用启用开关**:留着启用状态 LLM 可能会尝试调它然后被 501 打脸,不利于体验。文档里已经写明 M1 阶段把它的「启用」开关关掉。
5. **插件必须先「发布」一次才能被 Bot 引用**,新人容易卡在这一步("为什么 Bot 加插件时找不到我刚才建的那个?")。手记 Step 7 已经写明,但流程文档可以更显眼。

### 下一家(ChatGPT Actions / 元器 / 百炼) 需要改的地方

- **ChatGPT Custom GPT Actions**:
  - 鉴权字段名期望可能不一样,需要看 GPT Builder 的 Auth 配置 UI(它的 API Key Auth 默认放 `Authorization: Bearer <key>`,我们的是 `X-Skill-Key`,需要选 Custom Header 模式)
  - 它要求 OpenAPI servers.url 必须是 HTTPS + 公网可达(我们已经满足)
  - 它对 schema 严格,**这次补的 compare/recommend response schema 就是为它铺路**
  - 政策上对"返佣/购物链接"类工具更敏感,工具描述里要去掉"返佣"字样,改成"信息检索 / 比价"导向
- **腾讯元器 / 阿里百炼**:
  - 国内平台,鉴权和 Coze 大同小异,大概率 `X-Skill-Key` 直接复用
  - 元器目前对 OpenAPI 字段的解析比 Coze 严,可能要把 example 字段补全
- **文心智能体 / Dify**:
  - 同上,先做 Coze + ChatGPT 两家,其余按同一份 spec 复用
