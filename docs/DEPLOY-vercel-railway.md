# 🚀 Vercel + Railway 快速部署指南

本指南帮助你在 **10 分钟内** 完成免费部署。

---

## 📋 前置准备

- GitHub 账号
- Vercel 账号 (可用 GitHub 登录)
- Railway 账号 (可用 GitHub 登录)

---

## 第一步：部署后端到 Railway

### 1.1 登录 Railway

访问 [railway.app](https://railway.app)，使用 GitHub 登录。

### 1.2 创建 PostgreSQL 数据库

1. 点击 **New Project**
2. 选择 **Provision PostgreSQL**
3. 等待数据库创建完成
4. 点击数据库，查看 **Variables** 标签
5. 记录以下信息：
   - `DATABASE_URL` (或 `POSTGRES_URL`)
   - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

### 1.3 部署后端服务

1. 点击 **New Project** → **Deploy from GitHub repo**
2. 选择你的仓库 `Texas-Hold-em-Poker`
3. 配置部署：
   - **Root Directory**: `server`
   - Railway 会自动检测 Node.js

4. 添加环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产环境 |
| `JWT_SECRET` | `your-32-char-secret-here` | **必须修改！** |
| `DB_HOST` | 从数据库获取 | PostgreSQL 主机 |
| `DB_PORT` | 从数据库获取 | PostgreSQL 端口 |
| `DB_NAME` | 从数据库获取 | 数据库名 |
| `DB_USER` | 从数据库获取 | 数据库用户 |
| `DB_PASSWORD` | 从数据库获取 | 数据库密码 |

5. 点击 **Deploy**，等待部署完成

### 1.4 获取后端 URL

部署成功后：
1. 点击服务 → **Settings** → **Domains**
2. 点击 **Generate Domain**
3. 记录生成的 URL，例如：`https://poker-server-production.up.railway.app`

---

## 第二步：部署前端到 Vercel

### 2.1 登录 Vercel

访问 [vercel.com](https://vercel.com)，使用 GitHub 登录。

### 2.2 导入项目

1. 点击 **Add New** → **Project**
2. 选择你的 GitHub 仓库 `Texas-Hold-em-Poker`
3. 配置项目：
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 2.3 添加环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_API_URL` | `https://你的后端URL/api` | Railway 后端地址 |
| `VITE_WS_URL` | `https://你的后端URL` | WebSocket 地址 |
| `VITE_GOOGLE_CLIENT_ID` | 你的 Google Client ID | 可选 |

### 2.4 部署

点击 **Deploy**，等待部署完成。

### 2.5 获取前端 URL

部署成功后，Vercel 会提供一个 URL，例如：
`https://texas-hold-em-poker.vercel.app`

---

## 第三步：配置跨域

### 3.1 更新后端 CORS

在 Railway 后端服务中添加环境变量：

```
CORS_ORIGINS=https://你的前端URL.vercel.app
```

### 3.2 重新部署后端

Railway 会自动检测变量变化并重新部署。

---

## 第四步：验证部署

### 4.1 测试后端健康检查

访问：`https://你的后端URL/api/health`

应该返回：
```json
{"status":"ok","time":"2024-..."}
```

### 4.2 测试前端

访问你的 Vercel URL，尝试：
1. 游客登录
2. 进入大厅
3. 开始匹配

---

## 🔧 常见问题

### WebSocket 连接失败

**症状**：前端显示"连接断开"

**解决方案**：
1. 确认 `VITE_WS_URL` 已正确设置
2. 检查 Railway 后端日志是否有错误
3. 确认 CORS 配置正确

### 数据库连接失败

**症状**：后端启动失败

**解决方案**：
1. 检查所有 `DB_*` 环境变量
2. 确认 Railway PostgreSQL 服务正在运行
3. 查看后端日志获取详细错误

### 登录后立即断开

**症状**：登录成功但马上断开

**解决方案**：
1. 确认 `JWT_SECRET` 已设置且一致
2. 检查前端 `VITE_API_URL` 是否正确

---

## 💰 免费额度说明

### Vercel 免费额度
- 100GB 带宽/月
- 100 次部署/天
- 无限静态站点

### Railway 免费额度
- $5 免费额度/月
- PostgreSQL: ~$5/月 (512MB)
- 后端服务: ~$3-5/月

**注意**：免费额度可能不足以支撑 PostgreSQL + 后端服务整个月。建议：
- 使用外部免费数据库 (Supabase/Neon)
- 或升级 Railway 付费计划 ($5/月)

---

## 📊 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel + Railway 架构                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户 ──HTTPS──► Vercel (前端静态资源)                     │
│                         │                                   │
│                         │ API/WebSocket                     │
│                         ▼                                   │
│              Railway (Node.js 后端)                         │
│                         │                                   │
│                         ▼                                   │
│              Railway (PostgreSQL)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 下一步

部署成功后，你可以：
1. 绑定自定义域名
2. 配置 Google OAuth 登录
3. 设置监控告警
4. 升级到付费计划获得更多资源

---

## 📞 需要帮助？

如果遇到问题，请提供：
1. 后端日志 (Railway → 服务 → Logs)
2. 前端控制台错误
3. 具体的错误信息
