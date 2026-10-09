# MCP 集成说明

本项目基于麦当劳中国官方 MCP Server 构建，所有餐品数据均来自实时接口，不含任何手工整理或臆造内容。

## 一、接入的 MCP Server

| 项 | 值 |
| --- | --- |
| 名称 | `mcd-mcp` |
| 接入地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | `Authorization: Bearer <MCP Token>` |
| 限流约束 | 600 次 / 分钟（客户端已做串行调用，不会触发 429） |
| 官方文档 | https://open.mcd.cn/mcp · https://github.com/M-China/mcd-mcp-server |

配置示例见 [`mcp-config.example.json`](./mcp-config.example.json)，其中 Token **只允许以环境变量占位符**形式出现。

## 二、实际调用的 Tools

### 核心链路（图鉴生成）

| Tool | 用途 | 本项目的用法 |
| --- | --- | --- |
| `delivery-query-addresses` | 查询用户配送地址 | 取第一个地址作为"你在哪"的锚点 |
| `delivery-query-stores` | 查询地址可配送门店 | 得到 `storeCode` / `beCode`，后续所有查询都以它为基准 |
| `query-meals` | 查询门店可售菜单 | **图鉴主体数据源**：分类、餐品编码、标签、现价、原价、商品图 |
| `list-nutrition-foods` | 查询餐品营养成分 | 为图鉴补充热量、蛋白质、脂肪、碳水、钠、钙六个属性维度 |
| `order-list` | 查询历史订单 | **"已品尝"标记的唯一来源**：订单里的 `orderProductList[].productCode` 与菜单表做关联 |

### 未纳入，但接口能力已对齐

`create-order` / `calculate-price` / `query-my-account` / `campaign-calendar` / `draw-lottery` 等工具能力完整。本项目刻意不做自动下单与抽奖，避免把"收藏"引导成"消费"。

## 三、调用流程

```
delivery-query-addresses
        │  addressId
        ▼
delivery-query-stores ──────► storeCode + beCode
        │
        ├──────────────► query-meals ──────────┐
        │                  分类 / 标签 / 价格     │
        │                                       ├──► 按 code 聚合去重
        │                                       │    （同一餐品跨分类出现，
        │                                       │     tags 取并集后定级）
        ├──────────────► list-nutrition-foods ──┤
        │                  热量 / 营养素          │
        │                                       │
        └──────────────► order-list ────────────┘
                            productCode → 已品尝标记
                                       │
                                       ▼
                              data/catalog.json
                              data/catalog.js（脱敏后可发布）
```

## 四、关键技术处理

**1. 跨分类标签聚合**

同一餐品会同时挂在「人气热卖」和它自己的品类下，两个分类给出的 `tags` 并不一致（例如「XX四件套」在其中一个分类里丢了 `四件套` 标签）。若按常规做法只取首次出现的结果，套餐就会被误判成单品而混进游戏进化链。本项目先按 `code` 聚合、对 `tags` 取并集，再做定级判定。

**2. 上架日期推断**

`query-meals` 返回的 `image` 字段路径里带有日期（形如 `.../menu/20261008/product/MS_x.png`），据此可推算餐品上架时间，用于识别近期新品。

**3. 稀有度分型（regular / limited / merch）**

完全由接口返回的真实标签驱动，不做人工打标：

- `merch` 品牌周边：商品名含周边、棒球帽、毛绒等
- `limited` 限定：含「周末专享」「麦金卡」标签，或上架时间在 30 天内
- `regular` 常驻：其余

其中**只有 `regular` 会进入游戏进化链**，限定与周边永远刷不出来 —— 这是本项目稀缺性模型的地基。

**4. Token 不出本地**

浏览器的同源策略会让前端直接连 MCP 时既遇到 CORS 拦截、又暴露 Token。因此采用「本地脚本采集 → 产出静态数据 → 前端消费」的结构：Token 只存在于本地环境变量，仓库里只有脱敏后的 `catalog.js`。

## 五、业务价值

| 维度 | 说明 |
| --- | --- |
| 数据真实性 | 图鉴 133 项全部来自指定门店的当期在售菜单，价格与标签随官方更新而变 |
| 降低决策成本 | 用户不必手动维护"我吃过什么"，订单接口自动回溯 |
| 数据价值外溢 | `list-nutrition-foods` 的六项营养素被并入图鉴，让"收藏"同时具备营养对照能力 |
| 合规边界清晰 | 游戏侧不接触任何下单类接口，项目不诱导消费、不鼓励过量饮食 |

---

数据来源 © McDonald's. 本项目仅读取数据用于个人收藏展示，餐品信息、价格及供应状态以麦当劳官方渠道实时结果为准。
