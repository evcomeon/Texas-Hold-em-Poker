# 🚀 Texas Hold'em Poker - Deployment Guide

本指南介绍如何将德州扑克项目部署到生产环境。

## 📋 部署要求

- Docker 20.10+
- Docker Compose 2.0+
- 服务器: 1 CPU, 512MB+ RAM
- 端口: 80 (HTTP)

## 🏗️ 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                      生产环境部署                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────────┐         ┌──────────────────────────┐    │
│   │   Nginx      │◄────────│  静态资源 (Vite Build)   │    │
│   │   Port 80    │         │  - HTML/CSS/JS          │    │
│   └──────┬───────┘         └──────────────────────────┘    │
│          │                                                  │
│          │ Proxy                                            │
│          ▼                                                  │
│   ┌──────────────┐         ┌──────────────────────────┐    │
│   │   Node.js    │         │  WebSocket (Socket.IO)  │    │
│   │   Port 3001  │◄───────►│  - 实时游戏通信         │    │
│   │              │         │  - 大厅匹配系统         │    │
│   └──────────────┘         └──────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始 (推荐)

### 1. 克隆项目

```bash
git clone -b feature/multiplayer-lobby https://github.com/evcomeon/Texas-Hold-em-Poker.git
cd Texas-Hold-em-Poker
```

### 2. 配置环境变量

```bash
# 复制示例配置
cp server/.env.example server/.env

# 编辑配置 (必须修改 JWT_SECRET!)
nano server/.env
```

**必须修改的配置项：**
```env
# 生成一个强密钥 (至少32位)
JWT_SECRET=your-super-secret-random-key-here-min-32-chars

# 生产环境域名
CORS_ORIGINS=https://yourdomain.com

# Google OAuth (可选)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### 3. 一键部署

```bash
./scripts/deploy.sh
```

部署完成后，访问 `http://your-server-ip` 即可开始游戏。

## 🔧 手动部署

### Docker Compose 方式

```bash
# 构建并启动
docker-compose -f docker-compose.simple.yml up --build -d

# 查看日志
docker-compose -f docker-compose.simple.yml logs -f

# 停止服务
docker-compose -f docker-compose.simple.yml down
```

### 单独构建

```bash
# 构建前端
cd client && npm install && npm run build

# 构建并启动后端
cd ../server && npm install && npm start
```

## 🔒 HTTPS 配置 (Let's Encrypt)

### 使用 Certbot

```bash
# 安装 Certbot
docker run -it --rm \
  -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
  -v "$(pwd)/nginx/www:/var/www/certbot" \
  certbot/certbot certonly \
  --standalone \
  -d yourdomain.com

# 更新 Nginx 配置启用 HTTPS
# 参考 nginx/nginx-ssl.conf
```

## 📊 监控与维护

### 查看日志

```bash
# 实时日志
docker-compose -f docker-compose.simple.yml logs -f

# 最近100行
docker-compose -f docker-compose.simple.yml logs --tail=100
```

### 备份数据

```bash
./scripts/backup.sh
```

### 更新部署

```bash
# 拉取最新代码
git pull origin feature/multiplayer-lobby

# 重新部署
./scripts/deploy.sh
```

## 🌐 环境变量说明

### 后端环境变量 (server/.env)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 服务端口号 | `3001` |
| `JWT_SECRET` | JWT 签名密钥 | **必填** |
| `JWT_EXPIRES_IN` | Token 有效期 | `7d` |
| `CORS_ORIGINS` | 允许的跨域来源 | `http://localhost` |
| `GOOGLE_CLIENT_ID` | Google OAuth 客户端ID | 可选 |

### 前端环境变量 (client/.env)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_API_URL` | API 基础路径 | `/api` |
| `VITE_SOCKET_PATH` | WebSocket 路径 | `/socket.io` |
| `VITE_GOOGLE_CLIENT_ID` | Google 登录 Client ID | 可选 |

## 🐛 故障排查

### 服务无法启动

```bash
# 检查端口占用
sudo netstat -tlnp | grep :80

# 检查 Docker 状态
docker ps
docker-compose -f docker-compose.simple.yml ps
```

### WebSocket 连接失败

1. 检查防火墙是否放行端口
2. 确认 Nginx 配置中的 WebSocket 代理设置
3. 查看后端日志是否有连接错误

### JWT 验证失败

- 确认 `JWT_SECRET` 已正确设置
- 检查系统时间是否同步 (`ntpdate -s time.google.com`)

## 📁 文件说明

```
.
├── docker-compose.simple.yml  # 单容器部署配置
├── docker-compose.yml         # 多服务部署配置
├── Dockerfile                 # 多阶段构建配置
├── nginx/
│   ├── nginx.conf            # Nginx 反向代理配置
│   └── start.sh              # 容器启动脚本
├── scripts/
│   ├── deploy.sh             # 一键部署脚本
│   └── backup.sh             # 备份脚本
└── DEPLOYMENT.md             # 本文件
```

## 🎯 生产环境检查清单

- [ ] 修改 `JWT_SECRET` 为强密钥
- [ ] 配置正确的 `CORS_ORIGINS`
- [ ] 启用 HTTPS (Let's Encrypt)
- [ ] 配置防火墙规则
- [ ] 设置日志轮转 (logrotate)
- [ ] 配置监控告警
- [ ] 定期执行备份

## 📞 获取帮助

如有问题，请查看项目 Issues 或提交新的 Issue。
