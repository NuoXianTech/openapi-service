# API Service 构建与生产部署

`openapi-service` 是一个独立的 Node.js + Hono 服务。源码使用 TypeScript，生产入口是编译后的 `dist/index.js`；它需要一次轻量 TypeScript 构建，但不包含 Nuxt、Vue、Vite 或前端打包。

## 1. 构建边界

开发机或 CI 执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 只运行 `tsc -p tsconfig.build.json` 并生成 `dist/`。

生产服务器不使用 `pnpm dev` 或 `tsx watch`。推荐直接拉取 CI 已构建的镜像；服务器无需安装源码依赖，也无需执行 `pnpm build` 或 `docker build`。

## 2. 生产产物

正式版本提供两种产物：

| 产物 | 用途 |
| --- | --- |
| `ghcr.io/nuoxiantech/openapi-service:<version>` | 推荐；包含 Node 24、生产依赖、`dist/` 和内置资产，支持 amd64/arm64 |
| GitHub Release 的 `openapi-service-<version>.tar.gz` | 已包含 `dist/`，适合不能使用容器的 Linux 主机；部署时只安装生产依赖，不再编译 |

生产应固定版本号或镜像 digest。`latest` 始终保留，用于跟踪 `main` 的最新构建，不建议长期作为不可变生产版本。

## 3. Docker Compose 部署

Service 仓库根目录提供独立 `docker-compose.yml`，Platform 仓库不再捆绑启动 Service。

首次部署先准备共享私网、Service Token 和独立配置加密密钥：

```bash
docker network inspect openapi-network >/dev/null 2>&1 || \
  docker network create openapi-network
cp .env.example .env
node -e "const { randomBytes } = require('crypto'); console.log('API_SERVICE_TOKEN=' + randomBytes(32).toString('hex')); console.log('SERVICE_CONFIG_KEY=' + randomBytes(32).toString('hex'))"
```

把生成值写入 Service 仓库旁的 `.env`：

```env
API_SERVICE_TOKEN=replace-with-an-independent-random-value
SERVICE_CONFIG_KEY=replace-with-an-independent-64-character-hex-value
SERVICE_ID=openapi-service
SERVICE_NAME=OpenAPI Service
```

生产发布时把 `docker-compose.yml` 中的镜像从 `latest` 固定到目标版本，例如 `0.1.0`。然后启动：

```bash
mkdir -p data/assets/ip
docker compose pull
docker compose up -d
docker compose ps
```

Compose 会：

- 把 `./data/assets` 只读挂载到 `/app/data/assets`。
- 使用 `openapi-service-runtime` Volume 持久化 `/app/data/runtime`。
- 加入外部 `openapi-network`。
- 只在 Docker 私网暴露 8080，不默认发布公网端口。

Platform 与 Service 在同一 Docker 网络时，Internal Upstream Target 填写：

```text
http://openapi-service:8080
```

Service Token 在创建 Internal Upstream 时通过 Platform 管理后台填写并加密保存；Platform 的 `.env` 不需要、也不接受 `OPENAPI_SERVICE_TOKEN`。

## 4. 外挂数据

所有不能提交仓库的数据文件统一放到：

```text
data/assets/<module-id>/
```

IP 模块示例：

```text
data/assets/ip/cz88_public_v4.czdb
data/assets/ip/cz88_public_v6.czdb
```

每个模块文档必须列出固定文件名、来源、许可要求和缺失时的错误码。不得通过 Platform 或请求参数传入任意文件路径。完整规则见[运行维护](operations.md#2-数据目录约定)。

## 5. 跨服务器部署

Platform 与 Service 可以运行在不同服务器。此时应把 Service 端口只发布到私网地址，并在两端之间使用防火墙和 TLS：

```yaml
services:
  openapi-service:
    ports:
      - "10.0.0.20:8080:8080"
```

Platform 的 Target 使用私网或 HTTPS 地址，例如 `https://service.internal.example.com`。不要把 Service 直接作为面向最终用户的公共 API；外部调用仍应经过 Platform Gateway。

## 6. 非容器部署

从 GitHub Release 下载并校验：

```bash
sha256sum -c checksums.txt
tar -xzf openapi-service-0.1.0.tar.gz
cd openapi-service-0.1.0
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install --prod --frozen-lockfile
```

这一步只安装生产依赖，不执行 TypeScript 或前端构建。准备数据目录并启动：

```bash
export NODE_ENV=production
export API_SERVICE_TOKEN='replace-with-an-independent-random-value'
export SERVICE_CONFIG_KEY='replace-with-an-independent-64-character-hex-value'
export SERVICE_ID='openapi-service'
export SERVICE_NAME='OpenAPI Service'
export SERVICE_DATA_DIR=/var/lib/openapi-service
export LISTEN_ADDR=127.0.0.1:8080
pnpm start
```

`pnpm start` 只调用预编译的 Node 入口，并把 `package.json` 版本提供给 Service 观测信息，不会执行构建。使用 systemd、PM2 或面板进程守护时也可以直接运行 `node --enable-source-maps dist/index.js`；此时官方发布脚本应额外注入构建版本。`SERVICE_DATA_DIR/runtime` 必须可写并持久化，`SERVICE_DATA_DIR/assets` 应由运维方只读管理。

## 7. 部署验证

```bash
docker compose exec -T openapi-service node -e \
  "fetch('http://127.0.0.1:8080/healthz').then(r => { if (!r.ok) process.exit(1) })"
docker compose exec -T openapi-service node -e \
  "fetch('http://127.0.0.1:8080/readyz').then(r => { if (!r.ok) process.exit(1) })"
```

非容器部署可直接使用 `curl -fsS http://127.0.0.1:8080/healthz` 和 `/readyz`。

随后在 Platform：

1. 创建 Internal Upstream，填写 Target 和 Token。
2. 执行“发现 Service”。
3. 检查 OpenAPI、Endpoint 和业务配置 Schema。
4. 保存业务配置并确认所有 Target 已同步。
5. 发布测试 Endpoint，通过 Platform Gateway 使用 API Key 调用。
6. 确认调用日志、统计和积分扣除都由 Platform 正常记录。

## 8. 升级

Service 没有自己的数据库迁移。升级只替换镜像或发布目录，并保留 `SERVICE_DATA_DIR`：

```bash
docker compose pull
docker compose up -d --no-deps openapi-service
```

修改接口实现、OpenAPI 或配置 Schema 时只发布 Service，不停止 Platform。部署完成后重新发现契约；如果删除 Endpoint，必须先在 Platform 停用对应 Route。
