# 部署手册

## 环境信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 70.39.198.214 |
| SSH 用户 | maceo |
| SSH 端口 | 57806 |
| SSH 密钥 | `/Users/maceo/tencent-ssh/70_39_198_214.pem` |
| 域名 | shop.aini8.com |
| Cloudflare Zone | aini8.com（Zone ID: 3044ae83044dc3c0e9287383b2d5d1f6）|
| 源码目录（远程） | `/home/maceo/ldc-shop` |

---

## 架构说明

```
用户浏览器
    ↓ HTTPS
Cloudflare（SSL Flexible 模式，代理开启）
    ↓ HTTP
服务器 nginx :80
    ↓ 反向代理
Docker 容器 ldc-shop :3000
    ↓
Docker 容器 ldc-shop-db（PostgreSQL :5432）
```

---

## 首次部署步骤

### 1. 服务器准备

确保远程服务器已安装 Docker、Docker Compose、nginx。

```bash
ssh -i /Users/maceo/tencent-ssh/70_39_198_214.pem -p 57806 maceo@70.39.198.214
```

### 2. 配置 Cloudflare DNS

在 Cloudflare Dashboard（aini8.com）添加 A 记录：
- 名称：`shop`
- 内容：`70.39.198.214`
- 代理状态：**开启（橙色云朵）**

SSL/TLS 加密模式必须设置为 **Flexible**（路径：SSL/TLS → 概述）。

### 3. 配置 nginx

```bash
sudo tee /etc/nginx/sites-available/shop.aini8.com << 'EOF'
server {
    listen 80;
    server_name shop.aini8.com;
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/shop.aini8.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload
```

> 注意：`X-Forwarded-Proto` 必须硬编码为 `https`，不能用 `$scheme`，否则 next-auth 会认为请求是 HTTP，导致 CSRF 验证失败。  
> 后台「批量导入卡密」上传大文件时需 `client_max_body_size`（如上 64m），否则 nginx 会截断请求体。

### 4. 打包上传源码

在本地项目根目录执行：

```bash
tar -czf /tmp/ldc-shop-src.tar.gz \
  --exclude='.next' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='postgres-data' \
  .

scp -i /Users/maceo/tencent-ssh/70_39_198_214.pem -P 57806 \
  /tmp/ldc-shop-src.tar.gz maceo@70.39.198.214:/home/maceo/
```

### 5. 远程解压并构建

```bash
ssh -i /Users/maceo/tencent-ssh/70_39_198_214.pem -p 57806 maceo@70.39.198.214

mkdir -p /home/maceo/ldc-shop
tar -xzf ldc-shop-src.tar.gz -C /home/maceo/ldc-shop

cd /home/maceo/ldc-shop
docker build -t ldc-shop-app .
```

### 6. 启动服务

```bash
cd /home/maceo/ldc-shop
docker compose up -d
```

---

## 环境变量配置

`docker-compose.yml` 中 app 服务的环境变量（已配置好，勿覆盖）：

| 变量 | 值 |
|------|----|
| `POSTGRES_URL` | `postgresql://postgres:postgres@db:5432/ldc_shop` |
| `NEXT_PUBLIC_APP_URL` | `https://shop.aini8.com` |
| `AUTH_URL` | `https://shop.aini8.com` |
| `AUTH_TRUST_HOST` | `true` |
| `OAUTH_CLIENT_ID` / `SECRET` | 用于 **Linux DO Connect 登录** 的应用凭证（可与收款应用不同）。 |
| `MERCHANT_ID` / `MERCHANT_KEY` | **Epay 收款**：一般为你在 Connect 应用后台「API 配置」里对应 **收银** 应用的 Client ID / Secret（常为 `ec02…` / `c6c9…` 这类），须与网关 `pid`/密钥一致；勿与 OAuth 强行绑成同一组除非官方说明相同。 |
| `ADMIN_USERS` | `omg_lol`（Linux DO 登录名，逗号分隔多个） |

---

## LinuxDO OAuth 配置

在 [LinuxDO 开发者后台](https://connect.linux.do) 的应用配置中填写：

| 字段 | 值 |
|------|----|
| 应用主页 URL | `https://shop.aini8.com` |
| 回调 URI | `https://shop.aini8.com/api/auth/callback/linuxdo` |
| 通知 URL | `https://shop.aini8.com/api/auth/callback/linuxdo` |

---

## 更新部署（迭代发版）

```bash
# 1. 本地打包上传
tar -czf /tmp/ldc-shop-src.tar.gz \
  --exclude='.next' --exclude='node_modules' \
  --exclude='.git' --exclude='postgres-data' \
  . && \
scp -i /Users/maceo/tencent-ssh/70_39_198_214.pem -P 57806 \
  /tmp/ldc-shop-src.tar.gz maceo@70.39.198.214:/home/maceo/

# 2. 远程重建并重启
ssh -i /Users/maceo/tencent-ssh/70_39_198_214.pem -p 57806 maceo@70.39.198.214 \
  "cd /home/maceo && tar -xzf ldc-shop-src.tar.gz -C ldc-shop && \
   cd ldc-shop && docker build -t ldc-shop-app . && \
   docker compose down app && docker compose up -d app"
```

> 注意：每次解压会覆盖远程文件，包括 `docker-compose.yml`。本地的 `docker-compose.yml` 已包含正确配置，保持同步即可。

---

## 常用运维命令

```bash
# 查看容器状态
docker ps

# 查看应用日志
docker logs ldc-shop --tail 50 -f

# 重启应用
docker compose -f /home/maceo/ldc-shop/docker-compose.yml restart app

# 进入应用容器
docker exec -it ldc-shop sh

# 检查 nginx 配置
sudo nginx -t
sudo nginx -s reload
```

---

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| Cloudflare 521 | SSL 模式为 Full/Strict，源站无证书 | Cloudflare SSL 改为 Flexible |
| OAuth unauthorized_client | 回调地址不匹配，或禁用了 PKCE（Connect 要求 S256） | 回调填 `https://shop.aini8.com/api/auth/callback/linuxdo`；勿在 `auth.ts` 使用 `checks: []` |
| client_id 显示 replace_with_client_id | docker-compose.yml 被原始文件覆盖 | 重新写入正确环境变量后重启容器 |
| MissingCSRF 错误 | nginx `X-Forwarded-Proto` 传了 http | 改为硬编码 `https` |
