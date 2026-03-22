# Cetus Peg Watcher

Sui 区块链代币价格监控与自动交易工具。基于 Cetus DEX Aggregator API 监控价格，当价格突破阈值时发送 Telegram 通知，并可选地执行自动交易。

## 功能特性

- **实时价格监控**：通过 Cetus Aggregator API 轮询代币价格
- **双模式触发**：
  - 固定价格模式：`targetPrice` 绝对阈值
  - 均价百分比模式：`avgWindowMinutes` 内均价 × `avgTargetPercent`%
- **Telegram 分层通知**：价格信号与运维告警分层推送
- **自动交易**（可选）：满足条件时自动执行买卖（需配置助记词）
- **智能冷却**：预警和交易分别冷却，防止重复触发
- **状态持久化**：重启后保留冷却状态
- **API 重试**：失败时指数退避自动重试

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`，参考下方的配置说明。

### 3. 运行

```bash
npm start
```

或使用辅助脚本：

```bash
./start.sh
```

---

## 配置详解

### 全局配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `telegram` | object | - | - | Telegram Bot 通知配置（见下方） |
| `trade` | object | - | - | 交易配置（见下方） |
| `items` | array | ✅ | - | 监控项数组，至少 1 个 |

### Telegram 配置 (`telegram`)

Telegram 目前分为 3 类事件：

- `signal`：价格告警、交易提交中、交易成功、交易失败、交易待确认后的补发结果
- `ops`：配置错误、余额不足、交易执行异常（如 SDK/RPC 抛错）
- `silent`：轮询、冷却命中、等待确认、暂停/恢复等，仅写日志

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | - | `false` | 是否启用 Telegram 通知 |
| `botToken` | string | 当 enabled=true | - | Telegram Bot Token |
| `chatId` | string | 当 enabled=true | - | 接收消息的 chat id（群组通常是 `-100...`） |
| `messageThreadId` | number | - | - | 论坛群组的话题 ID（可选） |

### 交易配置 (`trade`)

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | - | `false` | 是否启用自动交易功能 |
| `mnemonicFile` | string | 当 enabled=true | - | 助记词文件路径（权限必须为 600） |
| `derivationPath` | string | - | `m/44'/784'/0'/0'/0'` | BIP44 派生路径 |
| `rpcUrl` | string | - | `https://fullnode.mainnet.sui.io:443` | Sui RPC 节点地址 |
| `slippagePercent` | number | - | `0.1` | 常规交易滑点容忍（百分比），如 0.1 表示 0.1% |
| `suiGasReserve` | number | - | `0.02` | 交易 SUI 时预留的 gas 数量 |
| `maxTradePercent` | number | - | `100` | 常规模式每次交易使用可用余额的比例（%），如 30 表示只用 30% |
| `fastTrackEnabled` | boolean | - | `true` | 是否启用极端偏离 fast-track 快速下单 |
| `fastTrackExtraPercent` | number | - | `1.5` | 在原触发线之外再多偏离多少百分点时，跳过 `tradeConfirmations` 立即下单 |
| `fastTrackTradePercent` | number | - | `75` | fast-track 模式下使用的可用余额比例（%） |
| `fastTrackSlippageMultiplier` | number | - | `0.35` | fast-track 动态滑点系数。超出 `fastTrackExtraPercent` 的每 1 个百分点，额外增加多少滑点 |
| `fastTrackMaxSlippagePercent` | number | - | `2` | fast-track 模式的滑点硬上限（%） |
| `statusPollDelayMs` | number | - | `1500` | 交易提交后，首次查询链上最终状态前等待的毫秒数 |
| `statusPollIntervalMs` | number | - | `1500` | 链上最终状态轮询间隔（毫秒） |
| `statusPollTimeoutMs` | number | - | `15000` | 单次交易状态查询超时时间。超时后先发 pending，再后台继续补发最终结果 |

### 监控项配置 (`items[]`)

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | ✅ | - | 规则唯一标识，必须全局唯一，冷却状态持久化依赖此字段 |
| `baseToken` | string | ✅ | - | 要监控的代币地址，如 `0x2::sui::SUI` |
| `targetPrice` | number | ⚠️ | - | 固定价格模式的目标价格（与 avgTargetPercent 二选一） |
| `avgTargetPercent` | number | ⚠️ | - | 均价百分比模式，如 103 表示均价的 103%（与 targetPrice 二选一） |
| `condition` | string | ✅ | - | 触发条件：`above`（高于）或 `below`（低于） |
| `quoteToken` | string | - | USDC 地址 | 计价货币，默认 USDC |
| `priceQueryMinBaseAmount` | number | - | `1` | 询价使用的最小 `baseToken` 数量，按人类单位填写，例如 `1000` 表示按 1000 个 baseToken 报价 |
| `pollInterval` | number | - | `30` | 轮询间隔（秒） |
| `alertCooldownSeconds` | number | - | `1800` | 预警冷却时间（秒） |
| `tradeCooldownSeconds` | number | - | `1800` | 交易冷却时间（秒） |
| `tradeConfirmations` | number | - | `2` | 连续命中阈值，同时控制预警发送和交易触发。连续命中 N 次后才发告警并下单（fast-track 时跳过此限制） |
| `avgWindowMinutes` | number | - | `10` | 均价计算窗口（分钟），仅 avg_percent 模式有效 |
| `avgResumeFactor` | number | - | `0.95` | 告警后恢复均价采样的回归系数（0~1，仅 avg_percent） |
| `alertMode` | string | - | 自动推断 | 触发模式：`price` 或 `avg_percent`，不填时根据 targetPrice/avgTargetPercent 自动推断 |
| `tradeEnabled` | boolean | - | `true` | 该币种是否允许自动交易 |

**⚠️ 重要规则**：
- `id` 必须填写且在所有监控项中唯一
- `targetPrice` 和 `avgTargetPercent` 必须**且只能配置一个**，否则启动时报错。

---

## 触发逻辑

### 1. 价格获取

- 调用 Cetus Aggregator API 查询当前价格
- 输入 `priceQueryMinBaseAmount` 个 baseToken 获取 quoteToken 报价，未配置时默认按 1 个单位
- 价格 = `amountOut / amountIn * 10^(baseDecimals - quoteDecimals)`

### 2. 触发条件判断

| alertMode | 参考价计算 | 触发条件 |
|-----------|------------|----------|
| `price` | `targetPrice` | `price >= targetPrice` (above) 或 `price <= targetPrice` (below) |
| `avg_percent` | `avgWindowPrice * (avgTargetPercent / 100)` | 同上逻辑，用均价百分比作为阈值 |

### 3. 交易方向判断

当 `trade.enabled = true` 且该币种 `tradeEnabled = true` 时：

```
condition = below → 买入 (buy)   // 价格跌破阈值，抄底买入
condition = above → 卖出 (sell)  // 价格涨破阈值，高位卖出
```

### 3.5 交易前复核（避免无效成交）

- 触发交易后，会按相同的 `priceQueryMinBaseAmount` 立刻再次请求最新报价（re-quote）
- 交易前需要连续 `tradeConfirmations` 次轮询都满足条件（默认 2 次）
- 若 `avg_percent` 模式下当前价格相对触发线的额外偏离达到 `fastTrackExtraPercent`，则进入 fast-track，跳过 `tradeConfirmations`
- 若 re-quote 已不满足阈值条件，则跳过本次交易
- 同一触发周期内，交易金额基于“首个触发时的可用金额”按 `maxTradePercent` 计算
- fast-track 模式下，交易金额改为按 `fastTrackTradePercent` 计算
- 若输入币是 SUI，会先预留 `suiGasReserve` 再计算可用金额

### 3.6 fast-track 与动态滑点

- fast-track 仅对 `avg_percent` 模式生效
- 先计算当前触发线：`triggerThreshold = avgWindowPrice * (avgTargetPercent / 100)`
- 再计算额外偏离：`overshootPercent = abs(currentPrice - triggerThreshold) / avgWindowPrice * 100`
- 当 `overshootPercent >= fastTrackExtraPercent` 时：
  - 直接跳过 `tradeConfirmations`
  - 使用 `fastTrackTradePercent`
  - 启用动态滑点

动态滑点公式：

```text
extraOvershootPercent = max(0, overshootPercent - fastTrackExtraPercent)
dynamicSlippage = slippagePercent + extraOvershootPercent * fastTrackSlippageMultiplier
finalSlippage = min(dynamicSlippage, fastTrackMaxSlippagePercent)
```

### 4. 冷却机制

- 预警冷却：按单条监控规则维度记录
- 规则身份：由 `items[].id` 决定，不受配置顺序影响
- 交易冷却：按 `baseToken + quoteToken + side` 维度记录（买入和卖出分别冷却）
- 运维告警冷却：按 `rule + issue type` 维度记录，默认 3600 秒

### 5. 均价采样暂停与恢复（仅 `avg_percent`）

- 触发并成功发送预警后，该规则会暂停重复触发，同时暂停将新价格写入均价窗口
- 恢复阈值基于 `avgTargetPercent` 和 `avgResumeFactor` 计算
- 偏离量：`deviation = abs(avgTargetPercent - 100) / 100`
- 恢复偏离：`recoverDeviation = deviation * avgResumeFactor`
- `condition=above` 恢复线：`avgPrice * (1 + deviation - recoverDeviation)`，当 `current <= 恢复线` 恢复采样
- `condition=below` 恢复线：`avgPrice * (1 - deviation + recoverDeviation)`，当 `current >= 恢复线` 恢复采样

---

## 交易执行流程

当触发交易条件时：

1. **计算可交易金额**
   - 查询钱包该币种可用余额
   - 若输入币为 SUI，预留 `suiGasReserve` 作为 gas
   - 常规模式乘以 `maxTradePercent`
   - fast-track 模式乘以 `fastTrackTradePercent`

2. **查询最优路由**
   - 使用 Cetus Aggregator SDK 的 `findRouters()`
   - 自动聚合多个 DEX（Cetus、FlowX、Turbos 等）
   - 返回最优兑换路径

3. **构建并执行交易**
   - `fastRouterSwap()` 自动合并多路径
   - 常规模式应用 `slippagePercent`
   - fast-track 模式按动态公式提高滑点，但不超过 `fastTrackMaxSlippagePercent`
   - 使用助记词签名并广播到链上

4. **结果处理**
   - 提交成功后不会立刻判定“交易成功”
   - 程序会按 `statusPollDelayMs / statusPollIntervalMs / statusPollTimeoutMs` 查询链上最终状态
   - 链上成功：发送 `signal` 类 Telegram 通知（含交易哈希、成交数量、成交价）
   - 链上失败：发送 `signal` 类 Telegram 通知（含真实链上错误原因）
   - 若短时间内查不到最终状态：先发 pending，后台继续查询，后续补发最终结果
   - 只有链上确认成功才会记录交易 cooldown

---

## 配置示例

### 示例 1：仅预警（不交易）

```json
{
  "telegram": {
    "enabled": false,
    "botToken": "123456789:YOUR_BOT_TOKEN",
    "chatId": "-1001234567890"
  },
  "items": [
    {
      "id": "sui-above-avg-103",
      "baseToken": "0x2::sui::SUI",
      "alertMode": "avg_percent",
      "condition": "above",
      "priceQueryMinBaseAmount": 1000,
      "avgWindowMinutes": 10,
      "avgTargetPercent": 103,
      "avgResumeFactor": 0.95,
      "pollInterval": 60,
      "alertCooldownSeconds": 1800,
      "tradeCooldownSeconds": 300,
      "tradeConfirmations": 2,
      "tradeEnabled": false
    }
  ]
}
```

### 示例 2：自动交易

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123456789:YOUR_BOT_TOKEN",
    "chatId": "-1001234567890"
  },
  "trade": {
    "enabled": true,
    "mnemonicFile": "./wallet.mnemonic",
    "derivationPath": "m/44'/784'/0'/0'/0'",
    "rpcUrl": "https://fullnode.mainnet.sui.io:443",
    "slippagePercent": 0.1,
    "suiGasReserve": 0.02,
    "maxTradePercent": 30,
    "fastTrackEnabled": true,
    "fastTrackExtraPercent": 1.5,
    "fastTrackTradePercent": 75,
    "fastTrackSlippageMultiplier": 0.35,
    "fastTrackMaxSlippagePercent": 2,
    "statusPollDelayMs": 1500,
    "statusPollIntervalMs": 1500,
    "statusPollTimeoutMs": 15000
  },
  "items": [
    {
      "id": "sui-above-avg-103",
      "baseToken": "0x2::sui::SUI",
      "alertMode": "avg_percent",
      "condition": "above",
      "priceQueryMinBaseAmount": 1000,
      "avgWindowMinutes": 10,
      "avgTargetPercent": 103,
      "avgResumeFactor": 0.95,
      "pollInterval": 60,
      "alertCooldownSeconds": 1800,
      "tradeCooldownSeconds": 300,
      "tradeConfirmations": 2,
      "tradeEnabled": true
    }
  ]
}
```

---

## 常用代币地址

| 代币 | 地址 |
|------|------|
| SUI | `0x2::sui::SUI` |
| Native USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| CETUS | `0x6864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS` |

---

## 安全说明

### 助记词安全

- **文件权限**：助记词文件必须设为 `600`，否则程序拒绝启动
- **存放位置**：建议放在项目目录外，避免误提交到版本控制
- **专用钱包**：使用专用小资金钱包，不要使用主资产钱包
- **运行环境**：服务器应开启磁盘加密、限制 SSH 登录、启用审计日志

### 交易风险

- **滑点损失**：极端行情下成交价可能低于预期（默认 0.1% 滑点）
- **Gas 消耗**：Sui 交易需要 Gas，建议保留足够余额
- **建议先测试**：首次启用交易前，建议先用 `maxTradePercent: 10` 小额测试
- **监控交易**：开启交易后持续关注钱包变化，发现异常立即停止

---

## 开发相关

### 编译

```bash
npm run build
```

### 开发模式运行

```bash
npm start
```

### 日志与排错

应用默认输出 JSON 结构化日志（单行一条），核心字段包括：
- `time`：ISO 时间
- `level`：日志级别数值（`10/20/30/40/50/60`）
- `levelName`：日志级别文本（`trace/debug/info/warn/error/fatal`）
- `service`：服务名（`cetus-peg-watcher`）
- `module`：模块名（如 `Runner`、`PriceOracle`、`Trade`、`Telegram`）
- `event`：事件名（如 `poll_loop_error`、`price_fetch_failed`）
- `msg`：可读消息
- `err`：错误对象（仅错误日志，包含 `type/message/stack`）

按错误级别筛选示例：

```bash
npm start 2>&1 | jq -c 'select(.level >= 50)'
```

开发时若希望可读格式日志（非 JSON）：

```bash
LOG_PRETTY=true npm start
```

### Docker 部署

```bash
docker-compose up --build
```

**注意**：Docker 部署时需确保 `config.json` 已存在；若启用交易，还需准备 `wallet.mnemonic` 并设置权限为 `600`。冷却状态（`data/state.json`）通过命名卷 `watcher-state` 持久化，重启后不会丢失。

---

## 目录结构

```
.
├── src/
│   ├── index.ts                  # 入口，信号处理，优雅关机
│   ├── config/
│   │   ├── loader.ts             # loadConfig() — 加载、校验、填默认值
│   │   ├── types.ts              # 原始输入类型（全部可选）
│   │   └── resolved.ts           # 解析后类型（全部必填）
│   ├── engine/
│   │   ├── orchestrator.ts       # startWatcher() — 分组、创建 Runner、启动定时器
│   │   └── runner.ts             # WatchGroupRunner — 每组轮询逻辑、告警分发
│   ├── pricing/
│   │   └── oracle.ts             # PriceOracle — HTTP keep-alive、请求去重、缓存
│   ├── cooldown/
│   │   └── manager.ts            # CooldownManager — 冷却状态、防抖写盘
│   ├── trading/
│   │   ├── context.ts            # TraderContext 工厂（keypair、SuiClient、Aggregator）
│   │   └── types.ts              # TradeSide、TradeStatus、TradeExecutionResult
│   ├── watcher-rules.ts          # 触发条件评估、fast-track 判断
│   ├── watcher-actions.ts        # 告警动作：复价、下单、构建消息
│   ├── watcher-logic.ts          # 状态 key 生成、暂停规则、串行轮询封装
│   ├── trader.ts                 # 交易执行：路由、签名、链上状态轮询
│   ├── telegram.ts               # Telegram Bot API 通知（含 429/5xx 重试）
│   ├── formatters.ts             # 金额/价格格式化
│   ├── logger.ts                 # Pino 结构化日志
│   ├── state.ts                  # state.json 读写
│   ├── cetus.ts                  # 向后兼容 shim → PriceOracle
│   └── config.ts                 # 向后兼容 re-export → config/
├── config.example.json           # 配置示例
├── config.json                   # 运行时配置（不提交）
├── data/
│   └── state.json                # 冷却状态文件（自动生成）
├── Dockerfile
└── docker-compose.yml
```

---

## 许可证

MIT
