# Poker Recharge Service

USDT/USDC 充值服务 - 独立运行的充值系统，通过监听区块链交易实现筹码充值。

## 功能特性

- 支持 USDT 和 USDC 充值
- 可配置的汇率 (1 USDT/USDC = X 筹码)
- 自动监听区块链交易
- 支持主网和测试网
- 完整的交易记录和日志
- RESTful API 接口

## 安装

```bash
cd recharge-service
npm install
```

## 配置

1. 复制配置文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置以下参数：

### 必需配置

| 参数 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 数据库连接字符串 |
| `RECHARGE_WALLET_ADDRESS` | 接收充值的钱包地址 |
| `RPC_URL` | 以太坊 RPC 节点地址 |
| `USDT_CONTRACT_ADDRESS` | USDT 合约地址 |
| `USDC_CONTRACT_ADDRESS` | USDC 合约地址 |

### 可选配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3002 | API 服务端口 |
| `CHIPS_PER_USD` | 10000 | 汇率：1 USD = X 筹码 |
| `MIN_RECHARGE_AMOUNT` | 1 | 最小充值金额 (USD) |
| `MAX_RECHARGE_AMOUNT` | 0 | 最大充值金额 (0=无限制) |
| `CONFIRMATION_BLOCKS` | 3 | 确认区块数 |
| `POLLING_INTERVAL` | 5000 | 轮询间隔 (毫秒) |

## 运行

### 启动完整服务 (API + 监听器)
```bash
npm start
```

### 仅启动区块链监听器
```bash
npm run monitor
```

### 开发模式
```bash
npm run dev
```

## API 接口

### 获取充值配置
```
GET /api/recharge/config
```

响应：
```json
{
  "walletAddress": "0x...",
  "tokens": {
    "usdt": { "address": "0x...", "symbol": "USDT", "decimals": 6 },
    "usdc": { "address": "0x...", "symbol": "USDC", "decimals": 6 }
  },
  "exchangeRate": 10000,
  "minAmount": 1,
  "maxAmount": 0
}
```

### 查询用户余额
```
GET /api/recharge/balance/:userId
Header: X-API-Key: your_api_key
```

### 查询充值历史
```
GET /api/recharge/history/:userId?limit=20&offset=0
Header: X-API-Key: your_api_key
```

### 检查交易状态
```
GET /api/recharge/check/:txHash
```

### 手动充值 (管理员)
```
POST /api/recharge/manual
Header: X-API-Key: your_api_key
Body: {
  "userId": 1,
  "txHash": "0x...",
  "tokenSymbol": "USDT",
  "tokenAmount": 10
}
```

### 充值统计
```
GET /api/recharge/stats
Header: X-API-Key: your_api_key
```

## 数据库表结构

### recharge_transactions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| user_id | INTEGER | 用户ID |
| tx_hash | VARCHAR(66) | 交易哈希 |
| token_symbol | VARCHAR(10) | 代币符号 |
| token_amount | NUMERIC | 代币金额 |
| chips_amount | INTEGER | 筹码数量 |
| from_address | VARCHAR(42) | 发送地址 |
| to_address | VARCHAR(42) | 接收地址 |
| block_number | BIGINT | 区块高度 |
| confirmations | INTEGER | 确认数 |
| status | VARCHAR(20) | 状态 |
| processed_at | TIMESTAMP | 处理时间 |
| created_at | TIMESTAMP | 创建时间 |

## 用户钱包绑定

系统需要知道用户的钱包地址才能自动处理充值。有两种方式实现：

### 方式1: 用户钱包表 (推荐)

在主项目数据库创建用户钱包表：
```sql
CREATE TABLE user_wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address VARCHAR(42) NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

然后修改 `blockchain.js` 中的 `findUserByWallet` 方法。

### 方式2: 用户表字段

在 users 表添加钱包地址字段：
```sql
ALTER TABLE users ADD COLUMN wallet_address VARCHAR(42);
```

## 主网合约地址

### Ethereum Mainnet
- USDT: `0xdAC17F958D2ee523a2206206994597C13D831ec7`
- USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`

### Polygon
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- USDC: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`

### BSC (Binance Smart Chain)
- USDT: `0x55d398326f99059fF775485246999027B3197955`
- USDC: `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`

## 安全注意事项

1. **私钥保护**: 永远不要将私钥提交到代码仓库
2. **API密钥**: 生产环境使用强随机密钥
3. **HTTPS**: 生产环境必须使用 HTTPS
4. **数据库访问**: 限制数据库访问权限
5. **日志审计**: 定期检查充值日志

## 与主项目集成

主项目需要调用充值服务的 API 来：

1. 获取充值钱包地址和配置
2. 查询用户充值历史
3. 检查交易状态

示例调用：
```javascript
// 在主项目中调用充值服务
const response = await fetch('http://localhost:3002/api/recharge/config');
const config = await response.json();

// 显示充值地址给用户
console.log(`请转账 USDT/USDC 到: ${config.walletAddress}`);
console.log(`汇率: 1 USD = ${config.exchangeRate} 筹码`);
```
