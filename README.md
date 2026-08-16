# OpenAPI Service

`openapi-service` 是 OpenAPI Platform 的独立 Node.js 业务 API 上游，使用 Hono、TypeScript 和 Node.js 24。它拥有独立进程、镜像、版本与回滚边界，不连接 Platform 的 PostgreSQL 或 Redis。

## 职责边界

Service 负责具体接口实现、业务数据、第三方来源访问、OpenAPI 契约、Service Token、超时、日志和健康检查。

Service 不负责：

- 用户、管理员、Session 或 OAuth。
- 调用方 API Key、Scope、限流、积分、计费和调用日志。
- Product、Version、Route、Upstream 或 Routing Revision。
- 运行时加载任意业务代码或管理其他进程。

所有公网请求先进入 `openapi-platform`，Platform 完成治理后以受信 Upstream 身份调用本服务。

## 可用接口

```text
GET /healthz
GET /readyz
GET /openapi.json
GET /.well-known/service.json
GET /.well-known/configuration-schema.json
GET /.well-known/configuration.json
PUT /.well-known/configuration.json

GET /v1/yiyan
GET /v1/player
GET /v1/player/art
GET /v1/player/assets/{asset}
GET /v1/ip
```

`/healthz` 与 `/readyz` 可在内部网络免 Token 访问，其余端点要求：

```http
Authorization: Service <token>
```

`/openapi.json` 提供稳定排序的 OpenAPI 3.1、`ETag` 和 `X-OpenAPI-SHA256`。

## 播放器资产

DPlayer 使用仓库自带的定制版本：

```text
assets/player/DPlayer.min.js
DPlayer 1.27.2 / nuoxi4n
```

它不是 npm 官方 `dplayer` 包。ArtPlayer、HLS、FLV 和 DASH 浏览器依赖使用固定 npm 版本。Docker 镜像会把 `assets/` 一并复制到运行层。

## 本地开发

```powershell
corepack enable
pnpm install
$env:API_SERVICE_TOKEN = 'replace-with-at-least-32-random-characters'
pnpm dev
```

生产依赖许可证门禁允许 0BSD、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC 与 MIT。

质量门禁：

```bash
pnpm licenses:check
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
pnpm measure:runtime
```

`pnpm build` 只执行服务端 TypeScript 编译，不运行 Nuxt、Vue 或 Vite。生产服务器只拉取并运行预构建镜像。

## 发布边界

- 修改 Platform Route、鉴权、积分或限流：只发布 Routing Revision，不构建 Service。
- 修改音乐平台开关/Cookie、IP 数据库密钥、Crypto 算法等已声明业务配置：在 Platform 保存并热更新 Service，不重启进程。
- 修改 Service Token、数据目录、网络或进程配置：滚动重启 Service，不重建 Platform。
- 修改接口实现、OpenAPI、配置 Schema 或依赖：只构建和替换 Service，不停止 Platform。

文档：

- [架构与代码边界](docs/architecture.md)
- [接口开发流程](docs/development.md)
- [业务配置协议与第三方扩展](docs/configuration.md)
- [运行、部署与回滚](docs/operations.md)
- [一言接口](docs/apis/yiyan.md)
- [播放器接口](docs/apis/player.md)
- [IP 接口](docs/apis/ip.md)
