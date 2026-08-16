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

质量门禁：

```bash
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
pnpm measure:runtime
```

`pnpm build` 只执行服务端 TypeScript 编译，不运行 Nuxt、Vue 或 Vite。生产服务器优先拉取预构建镜像；非容器部署使用 GitHub Release 中已编译的 `dist/`，不在服务器重新构建源码。

## 发布边界

- 修改 Platform Route、鉴权、积分或限流：只发布 Routing Revision，不构建 Service。
- 修改音乐平台开关/Cookie、IP 数据库密钥、Crypto 算法等已声明业务配置：在 Platform 保存并热更新 Service，不重启进程。
- 修改 Service Token、统一数据根目录、网络或进程配置：滚动重启 Service，不重建 Platform。
- 修改接口实现、OpenAPI、配置 Schema 或依赖：只构建和替换 Service，不停止 Platform。

文档：

- [架构与代码边界](docs/architecture.md)
- [接口开发流程](docs/development.md)
- [业务配置协议与第三方扩展](docs/configuration.md)
- [构建与生产部署](docs/deployment.md)
- [运行维护](docs/operations.md)
- [版本发布流程](docs/release.md)
- [一言接口](docs/apis/yiyan.md)
- [播放器接口](docs/apis/player.md)
- [IP 接口](docs/apis/ip.md)

## 致谢

部分内置公开 API 基于或参考了以下项目：

- [emoji-aes](https://github.com/a8763506128977812212307169331690/emoji-aes)
- [taiji-encode](https://github.com/Cat7373/taiji-encode)
- [beast_sdk](https://github.com/SycAlright/beast_sdk)
- [Core-Values-Encoder](https://github.com/wTool/Core-Values-Encoder)
- [talk-with-buddha](https://github.com/takuron/talk-with-buddha)
- [sentences-bundle](https://github.com/hitokoto-osc/sentences-bundle)
- [doubao-nomark](https://github.com/ihmily/doubao-nomark)
- [60s](https://github.com/vikiboss/60s)
- [Meting](https://github.com/metowolf/Meting)
- [Meting-API](https://github.com/metowolf/Meting-API)
- [short_videos](https://github.com/jiuhunwl/short_videos)
- [60s-static-host](https://github.com/vikiboss/60s-static-host)
- [LanzouAPI](https://github.com/hanximeng/LanzouAPI)
- [v50](https://github.com/vikiboss/v50)

## 许可证

[MIT](LICENSE) © NuoXianTech
