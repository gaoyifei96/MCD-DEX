# WorkBuddy 开发上下文

本文件记录本项目的开发过程，用于核验是否符合「麦当劳程序员创意开发大赛」的 WorkBuddy 联动活动奖励条件。

## 使用的工具与能力

- **WorkBuddy 连接器（自定义 MCP）**：在 WorkBuddy 中配置并启用 `mcd-mcp`，连接麦当劳中国官方 MCP Server `https://mcp.mcd.cn`
- **WorkBuddy 对话式开发**：从需求拆解、技术方案讨论、代码实现到文档撰写，全程在 WorkBuddy 会话中完成

## MCP 探索过程

在正式写代码前，先通过 WorkBuddy 逐个实测了接口返回结构，用于确定数据模型：

| Tool | 验证目的 | 结论 |
| --- | --- | --- |
| `now-time-info` | 连通性 | 握手成功，服务端无状态模式（无 session-id） |
| `list-nutrition-foods` | 营养数据格式 | 返回定宽文本表，160 项，含热量/蛋白/脂肪/碳水/钠/钙 |
| `delivery-query-addresses` | 地址列表 | 返回 addressId 用于选店 |
| `delivery-query-stores` | 门店列表 | 得到 storeCode + beCode |
| `query-meals` | 菜单结构 | 返回 categories + meals 映射表，含 tags、现价、原价、图片 |
| `order-list` | **历史订单能否返回餐品明细** | 字段定义含 `orderProductList[].productCode` / `productName` / `quantity` / `comboItemList` —— 这是「图鉴能否自动点亮」的可行性前提 |
| `mall-order-list` | 商城订单 | 与历史订单互补 |
| `query-my-account` | 积分账户 | 可用，暂未纳入产品 |

## 关键决策（在 WorkBuddy 会话中讨论确定）

1. **选题**：避开营养/省钱/点餐等红海方向，选择「图鉴收集 + 1024 游戏」
2. **双轨图鉴**：针对「游戏会稀释稀缺性」的质疑，确定已品尝（仅真实订单）与已收录（含游戏）分离，且限定与周边在游戏内不可达
3. **游戏联动而非附属**：游戏是图鉴的一条解锁路径，同时解决无订单用户的冷启动问题
4. **合规处理**：游戏不使用下单类接口；合并轴采用规格/稀有度层级而非热量最大化，避免宣扬不健康饮食；不与其他品牌做对比
5. **棋盘尺寸**：通过蒙特卡洛验证（随机策略 ~2%、启发式 ~21% 通关）确定采用 5×5 而非 4×4

## 产出

```
src/mcp-client.mjs   极简 MCP Streamable HTTP 客户端
src/collector.mjs    三源数据采集与合并
src/probe.mjs        连通性自检
src/test-game.mjs    难度曲线验证
web/                 图鉴 + 1024 游戏单页应用（零依赖）
data/catalog.js      脱敏示例数据
README.md / MCP_INTEGRATION.md / CONTEST_DECLARATION.md / mcp-config.example.json
```

## 安全说明

- MCP Token 全程保存在本地 `~/.workbuddy/mcp.json`，未出现在任何对话消息中
- 产出文件不含 Token、手机号、门牌地址
- `mcp-config.example.json` 中 Token 位置仅使用 `${MCD_MCP_TOKEN}` 环境变量占位符
