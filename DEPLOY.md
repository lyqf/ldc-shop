# ldc-shop 部署与配置手册（端到端）

本文目标：按顺序操作即可 **从零完成部署**，并理解 **Linux DO 登录与积分收款**、**反向代理**、**大文件导入** 等易错点。示例中的 IP、域名、路径为历史环境，请全部替换为你自己的值。

---

## 目录

1. [架构与端口](#1-架构与端口)
2. [前置条件检查清单](#2-前置条件检查清单)
3. [Linux DO：两个「应用」两套凭据](#3-linux-do两个应用两套凭据必读)
4. [服务器基础环境](#4-服务器基础环境)
5. [Cloudflare DNS 与 SSL](#5-cloudflare-dns-与-ssl)
6. [nginx（含大文件与 OAuth 头）](#6-nginx含大文件与-oauth-头)
7. [配置 docker-compose 环境变量](#7-配置-docker-compose-环境变量)
8. [首次部署：源码同步、构建、启动](#8-首次部署源码同步构建启动)
9. [更新发版（不改库数据）](#9-更新发版不改库数据)
10. [部署后验证清单（100% 对照）](#10-部署后验证清单100-对照)
11. [运维常用命令](#11-运维常用命令)
12. [磁盘与 Docker 清理](#12-磁盘与-docker-清理)
13. [后台与卡密导入](#13-后台与卡密导入)
14. [故障排查索引](#14-故障排查索引)

---

## 1. 架构与端口

```
访客浏览器
    ↓ HTTPS
Cloudflare（建议 SSL 模式：Flexible；代理：已代理）
    ↓ HTTP（到源站 80）
nginx（:80）— client_max_body_size、X-Forwarded-Proto 等
    ↓ proxy_pass
Docker：ldc-shop（Next.js :3000）
    ↓
Docker：ldc-shop-db（PostgreSQL :5432，数据卷持久化）
```

- 应用 **不** 在宿主机直接对外暴露 3000（由 nginx 反代）；防火墙只需开放 **80/443**（若证书在源站则另议；本手册配合 Cloudflare Flexible 常用 **80**）。
- 数据库端口映射到宿主机时注意安全组（可选用防火墙仅允许本机访问）。

---

## 2. 前置条件检查清单

| 序号 | 项 | 说明 |
|------|----|------|
| 1 | Linux 主机 | 有足够磁盘（建议根分区 ≥20GB 可用留给 Docker 构建与镜像） |
| 2 | Docker + Compose | `docker compose version` 可用 |
| 3 | nginx | 可监听 80，`nginx -t` 通过 |
| 4 | 域名 | A/AAAA 指向服务器；若用 Cloudflare，明确 SSL 策略 |
| 5 | SSH | 密钥登录或密码登录可用 |
| 6 | Git（可选） | 服务器也可用 `git pull` 取代 tar 发包 |

---

## 3. Linux DO：两个「应用」两套凭据（必读）

在 [Linux DO Connect / 开发者后台](https://connect.linux.do) 可创建 **多个应用**。本项目 **至少需要弄清下面两类**，**不要总是填成同一组**，否则易出现「登录正常但付款 `record not found`」等问题。

### 3.1 用于「OAuth 登录」— `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`

- 用途：用户在站点点击「Linux DO 登录」走的是 **OIDC**，对应 Connect 应用的 **Client ID / Client Secret**。
- Connect 的发现文档要求 **PKCE（S256）**。仓库内 `src/lib/auth.ts` 已为 **OIDC + 默认 PKCE**，**不要** 再设置 `checks: []`。
- 在应用后台配置的 **回调 URI**（须与代码一致）：

  `https://<你的域名>/api/auth/callback/linuxdo`

- **应用主页、通知 URL** 按后台说明填写为你的站点根或同一回调策略即可（以官方表单为准）。

### 3.2 用于「积分 Epay 收款」— `MERCHANT_ID` / `MERCHANT_KEY`

- 用途：`POST` 到 `https://credit.linux.do/epay/pay/submit.php` 时的 **`pid`** 与签名用的 **商户密钥**。
- 网关若查不到商户，会返回类似 **`record not found`**。
- **实践结论**：这一对往往对应你在 Connect 里为 **收银/收款** 建的那个应用的 **同一组 Client ID / Client Secret（长 hex）**；而 **OAuth 登录**可能绑在另一个短 ID 格式的应用上——**两组可以不同**，`docker-compose.yml` 里应 **分别填写**：
  - `OAUTH_*` → 登录用应用  
  - `MERCHANT_*` → 收款用应用（网关认 `pid` 的那套）

填写错误时的典型现象：

| 现象 | 可能原因 |
|------|----------|
| 跳转 Epay JSON `record not found` | `MERCHANT_ID`（pid）不是 Epay 里存在的商户 ID |
| 登录页 OAuth `unauthorized_client` / invalid client_id | `OAUTH_CLIENT_ID` 与当前应用不匹配，或回调 URI 不一致；或禁用 PKCE |
| 登录正常、付款报错 | OAuth 用的 A 应用，Merchant 却成了 B 或未开通收款的应用的 ID |

---

## 7. 配置 docker-compose 环境变量

文件：`docker-compose.yml`（`services.app.environment`）。生产环境请将占位符替换为真实值。**敏感信息不要提交到公开仓库**，建议私有仓库或使用部署机上的私有覆盖文件策略。

| 变量 | 必填 | 说明 |
|------|------|------|
| `POSTGRES_URL` | 是 | Compose 内置库示例：`postgresql://postgres:postgres@db:5432/ldc_shop`（与下方 db 服务一致） |
| `NEXT_PUBLIC_APP_URL` | 是 | 浏览器访问的站点根 URL，`https://你的域名`，无尾随斜杠问题一般不大但建议与其它统一 |
| `AUTH_URL` | 是 | 与 `NEXT_PUBLIC_APP_URL` 保持一致（Auth.js 服务端 URL） |
| `AUTH_TRUST_HOST` | 是 | 反代场景下设 `true` |
| `OAUTH_CLIENT_ID` | 是 | §3.1 **登录应用** Client ID |
| `OAUTH_CLIENT_SECRET` | 是 | §3.1 **登录应用** Secret |
| `MERCHANT_ID` | 是 | §3.2 Epay **`pid`**，多为 **收款应用** Client ID |
| `MERCHANT_KEY` | 是 | §3.2 Epay 签名密钥，多为 **收款应用** Secret |
| `ADMIN_USERS` | 是 | 后台管理员 Linux DO **用户名**，逗号分隔；仅这些用户可访问 `/admin`** |

可选增强（未在默认 compose 中时仍可用全局习惯）：

- `NEXTAUTH_SECRET` / `AUTH_SECRET`：会话加密；若不设，仓库内会用 `OAUTH_CLIENT_SECRET` 回退——生产建议单独设高强度随机字符串。

应用内约定的支付回调路由（无需改代码，但需在商户/Epay 白名单或后台可配的范围内）：

- 异步：`https://<你的域名>/api/notify`
- 同步：`https://<你的域名>/callback/<订单号>`（由下单时拼装）

修改 `docker-compose.yml` 后务必：

```bash
cd /home/<用户>/ldc-shop && docker compose up -d app
```

---

## 4. 服务器基础环境

### 安装 Docker（示例：Debian/Ubuntu 系）

按官方文档安装 **Docker Engine** 与 **Compose 插件**，确保：

```bash
docker --version && docker compose version
```

### 创建工作目录（示例）

```bash
mkdir -p /home/<用户>/ldc-shop
```

下文以 `/home/<用户>/ldc-shop` 表示远程源码与 `postgres-data` 所在目录。

---

## 5. Cloudflare DNS 与 SSL

1. DNS：为商店子域添加 **A 记录**指向源站 IP，**代理开启**（橙色云朵）。
2. SSL/TLS → **概述**：若源站 **没有** HTTPS 证书、仅 nginx 监听 80，则使用 **Flexible**（访客—Cloudflare 为 HTTPS，Cloudflare—源站为 HTTP）。  
   - 若为 **Full(Strict)** 而源站无证书，易出现 **521**。
3. 记下 Zone 等信息仅在排障时使用，部署不强依赖 Zone ID。

---

## 6. nginx（含大文件与 OAuth 头）

**必须**：

- **`X-Forwarded-Proto https`**（硬编码，不要用 `$scheme`），否则 NextAuth / Auth.js 易报 **MissingCSRF** 等。
- **`client_max_body_size 64m;`**（或更大）：后台 **批量导入卡密** 走 Server Action +  multipart，默认 nginx `1m` 会截断大包。

示例站点块（按需改 `server_name`）：

```nginx
server {
    listen 80;
    server_name shop.example.com;
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
```

```bash
sudo nginx -t && sudo nginx -s reload
```

---

## 8. 首次部署：源码同步、构建、启动

### 8.1 从本机打包（推荐使用 `COPYFILE_DISABLE` 避免 macOS 冗余 `._*` 文件）

在本机仓库根目录（含 `Dockerfile`、`docker-compose.yml` 的一层）：

```bash
export COPYFILE_DISABLE=1
cd /path/to/ldc-shop

tar -czf /tmp/ldc-shop-src.tar.gz \
  --exclude='.next' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='postgres-data' \
  --exclude='_workers_next' \
  --exclude='_docker' \
  .
```

说明：

- **`postgres-data` 切勿打进包**：数据只在服务器目录下由 Docker 创建；可避免误覆盖。
- 排除 **`_workers_next` / `_docker`**：多为本地实验副本，不参与标准 Docker 构建。

上传：

```bash
scp -P <SSH端口> /tmp/ldc-shop-src.tar.gz <用户>@<服务器>:/home/<用户>/
```

### 8.2 远程解压（空目录初始化）

首次：

```bash
ssh -p <SSH端口> <用户>@<服务器>
mkdir -p /home/<用户>/ldc-shop
cd /home/<用户>
tar -xzf ldc-shop-src.tar.gz -C ldc-shop
```

若曾遇 **磁盘满导致 tar 解压出 0 字节文件**：先 **`docker builder prune -af`** 及部分镜像清理腾出空间后，再 **删掉损坏目录、保留 `postgres-data` 迁出备份**、重建目录后重来（见 §12）。

### 8.3 写好 `docker-compose.yml` 后构建并启动全栈

```bash
cd /home/<用户>/ldc-shop

# 按需先编辑 docker-compose.yml 内全部环境变量
docker compose build app
docker compose up -d
```

`postgres-data` 以卷绑定在 `./postgres-data`，**重启容器数据保留**。

### 8.4 仅重建应用镜像（db 已在跑）

```bash
docker compose build app && docker compose up -d app
```

---

## 9. 更新发版（不改库数据）

**推荐流程**与本机再打一次包上传一致；远程 **解压会覆盖同名文件**，因此：

1. **在 Git 仓库维护好当前的 `docker-compose.yml`**（含密钥），发版时不要用手写错的模板覆盖。
2. 若线上 `docker-compose` 已手工改过，发版前先 **备份**：

   `cp docker-compose.yml docker-compose.yml.bak`

一键示例（单行可脚本化）：

```bash
export COPYFILE_DISABLE=1
cd /path/to/ldc-shop && \
tar -czf /tmp/ldc-shop-src.tar.gz \
  --exclude='.next' --exclude='node_modules' --exclude='.git' \
  --exclude='postgres-data' --exclude='_workers_next' --exclude='_docker' . && \
scp -P <端口> /tmp/ldc-shop-src.tar.gz <用户>@<主机>:/home/<用户>/ && \
ssh -p <端口> <用户>@<主机> "
  cd /home/<用户> && tar -xzf ldc-shop-src.tar.gz -C ldc-shop && \
  cd ldc-shop && docker compose build app && docker compose up -d app
"
```

无缓存强迫症时可：`docker compose build --no-cache app`（耗时显著增加）。

服务器也可改为 `git pull` + 同上 compose build（注意仍要排除地把 `postgres-data` 留在磁盘、勿提交）。

---

## 10. 部署后验证清单（100% 对照）

| 序号 | 检查项 | 如何验证 |
|------|--------|----------|
| 1 | 首页可开 | 浏览器打开 `https://你的域名/` |
| 2 | HTTPS | 浏览器锁图标正常；若为 Flexible，仅 CF 边缘证书亦可 |
| 3 | OAuth 登录 | 点击登录跳转 Connect，成功后回到站点，`/orders` 等需登录页可访问 |
| 4 | 后台权限 | Linux DO 用户名为 `ADMIN_USERS` 之一时访问 `/admin`，非名单用户应为 404 |
| 5 | Epay | 任一非零金额商品下单，跳转 `credit.linux.do/...submit.php`，**不应** JSON `record not found` |
| 6 | 回调 | 支付完成后订单状态可查；`/api/notify` 可被外网 POST（防火墙/Cloudflare） |
| 7 | 大文件导入（若用） | 后台卡密批量上传 **`client_max_body_size`** 已为 64m，且 `next.config` 中 `experimental.serverActions.bodySizeLimit` 已放宽 |

---

## 11. 运维常用命令

```bash
cd /home/<用户>/ldc-shop

docker compose ps
docker logs ldc-shop --tail 100 -f
docker compose restart app

docker exec -it ldc-shop sh
docker exec ldc-shop-db psql -U postgres -d ldc_shop -c '\dt'
```

---

## 12. 磁盘与 Docker 清理

- **根分区满** 时 `tar` 可能写出 **空文件**、`docker compose` 异常；先：

  ```bash
  df -h /
  docker system df
  docker builder prune -af
  docker image prune -f
  ```

- 大日志（如 `/var/log/daemon.log`）可配合 logrotate 或运维规范清理；**勿删** `ldc-shop/postgres-data` 除非明确要重建库。

---

## 13. 后台与卡密导入

- **后台地址**：`https://<你的域名>/admin`（须 `ADMIN_USERS` 内用户名登录）。
- **库存**：商品详情进「管理卡密」路由 `/admin/cards/<productId>`。
- **导入**：支持 **多行文本**、**单/多文件**（`.txt` / `.json` / `.jsonl`）；**每条卡密建议一行**；JSON 对象 **勿用逗号当分隔符**（内含逗号会被误切，除非整行单条 JSON）。
- **请求体限制**：应用侧 Server Action 默认已加大；**nginx 必须** `client_max_body_size`（见 §6）。
- **买家取货**：订单页展示 **文本** + 复制，不提供自动下载文件。

---

## 14. 故障排查索引

| 现象 | 处理方向 |
|------|----------|
| Cloudflare **521** | 源站未监听/防火墙；或 SSL 模式与源站证书不匹配 → 无证书用 **Flexible** |
| OAuth **`unauthorized_client`** / invalid `client_id` | 核对 `OAUTH_CLIENT_ID`；回调 URI；确保未禁用 PKCE（`auth.ts` 勿 `checks: []`） |
| Epay JSON **`record not found`** | 核对 `MERCHANT_ID` 是否为 Epay 认可的 **pid**；与 `MERCHANT_KEY` 同应用；勿与 OAuth 应用混用错套 |
| **MissingCSRF** | nginx 将 `X-Forwarded-Proto` 设为 **`https`** |
| 卡密上传失败 / 截断 | nginx **`client_max_body_size`**；总上传超过应用 64MB 上限则分批 |
| 解压后 **compose 空文件、全站 500** | 磁盘满或损坏；按 §12 清空间后自 Git/备份恢复 `docker-compose.yml` 与源码 |
| `replace_with_client_id` 文案 | compose 占位符未替换，填真实 OAuth/Epay |

---

## 附录 A：示例环境快照（仅供参考，请替换）

以下为历史示例，新建环境请逐项替换为你的 IP、用户、密钥路径与域名：

| 项 | 示例 |
|----|------|
| 服务器 | `YOUR_IP` |
| SSH | `YOUR_USER`，端口 `YOUR_PORT`，密钥 `/path/to/id_rsa` |
| 域名 | `shop.example.com` |
| 远程目录 | `/home/YOUR_USER/ldc-shop` |

---

## 附录 B：与安全相关的建议

1. **`docker-compose.yml` 含密钥**：公开 GitHub 前改为 **占位符**，真实文件仅保存在私有仓库或主机。
2. **轮换密钥**：OAuth Secret / Merchant Key 一旦泄露，在 Linux DO 后台轮换并同步更新 compose。
3. **数据库**：默认 compose 暴露 `5432`，生产建议防火墙限制或关掉宿主机映射，仅 Docker 内部访问。
4. **HTTPS 与 Flexible**：Flexible 仅在「源站无证书」时使用；能接受源站自建证书后可改为 Full(Strict)。

---

文档版本与仓库同步维护；若有平台侧接口变更（Epay/OAuth），以 Linux DO 官方说明为准并在本文 §3 / §14 更新条目。
