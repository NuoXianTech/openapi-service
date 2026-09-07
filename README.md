# OpenAPI Service

`openapi-service` 是 OpenAPI Platform 的独立 Node.js 业务 API 上游，使用 Hono、TypeScript 和 Node.js 24。它拥有独立进程、镜像、版本与回滚边界，不连接 Platform 的 PostgreSQL 或 Redis。

Service 与 Platform 独立发布，软件版本号不要求相同。`/.well-known/service.json` 通过 `serviceProtocol: "openapi-service/v1"` 声明当前控制协议，Platform 在发现阶段据此确认通信兼容性；`version` 与 `commit` 仅用于观测。业务接口的 `/v1`、`/v2` 由 OpenAPI 声明，可以并存并由 Platform 分别发布，不与控制协议或任一项目的软件版本绑定。

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
GET /v1/ai-media/doubao
GET /v1/ai-media/jimeng
GET /v1/ai-media/xiaoyunque
GET /v1/ai-media/kling
GET /v1/ai-media/hailuo
GET /v1/ai-media/qianwen
GET /v1/player
GET /v1/player/art
GET /v1/player/assets/{asset} (support)
GET /v1/ip
GET /v1/60s
GET /v1/bing
GET|POST /v1/crypto
GET /v1/epic
GET /v1/exchange-rate
GET /v1/fuel-price
GET /v1/fuel-price/regions (support)
GET /v1/gold-price
GET /v1/lanzou
GET /v1/luck
GET /v1/minecraft
GET /v1/music
POST /v1/password/check
GET /v1/password
GET /v1/qq-avatar
GET /v1/short-video
GET /v1/today-in-history
```

`/healthz` 与 `/readyz` 可在内部网络免 Token 访问，其余端点要求：

```http
Authorization: Service <token>
```

`/openapi.json` 提供稳定排序的 OpenAPI 3.1、`ETag` 和 `X-OpenAPI-SHA256`。

## 本地开发

```powershell
corepack enable
pnpm install
$env:API_SERVICE_TOKEN = 'replace-with-at-least-32-random-characters'
$env:SERVICE_CONFIG_KEY = 'replace-with-an-independent-32-byte-key'
pnpm dev
```

质量门禁：

```bash
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 只执行服务端 TypeScript 编译，不运行 Nuxt、Vue 或 Vite。生产服务器优先拉取预构建镜像；非容器部署使用 GitHub Release 中已编译的 `dist/`，不在服务器重新构建源码。

## 发布边界

- 修改 Platform Route、鉴权、积分或限流：只发布 Routing Revision，不构建 Service。
- 修改音乐平台开关/Cookie、IP 数据库密钥、Crypto 算法等已声明业务配置：在 Platform 保存并热更新 Service，不重启进程。
- 修改 Service Token、统一数据根目录、网络或进程配置：滚动重启 Service，不重建 Platform。
- 修改接口实现、OpenAPI、配置 Schema 或依赖：只构建和替换 Service，不停止 Platform。
- 新增破坏性业务接口：新增 `/v2/...` 并在迁移期保留 `/v1/...`；只要控制面仍兼容，就继续使用 `openapi-service/v1`。
- 修改发现、认证或配置同步协议且无法向后兼容：发布新的控制协议（例如 `openapi-service/v2`），并由 Platform 显式增加适配后再部署该组合。

文档：

- [架构与代码边界](docs/architecture.md)
- [接口开发流程](docs/development.md)
- [业务配置协议与第三方扩展](docs/configuration.md)
- [构建与生产部署](docs/deployment.md)
- [运行维护](docs/operations.md)
- [版本发布流程](docs/release.md)
- [一言接口](docs/apis/yiyan.md)
- [AI 媒体解析与去水印接口](docs/apis/ai-media.md)
- [播放器接口](docs/apis/player.md)
- [IP 接口](docs/apis/ip.md)
- [每日 60 秒接口](docs/apis/60s.md)
- [Bing 每日壁纸接口](docs/apis/bing.md)
- [加密与解密接口](docs/apis/crypto.md)
- [Epic 免费游戏接口](docs/apis/epic.md)
- [汇率接口](docs/apis/exchange-rate.md)
- [国内油价接口](docs/apis/fuel-price.md)
- [贵金属价格接口](docs/apis/gold-price.md)
- [蓝奏云链接解析接口](docs/apis/lanzou.md)
- [今日运势接口](docs/apis/luck.md)
- [Minecraft 玩家资料接口](docs/apis/minecraft.md)
- [音乐解析接口](docs/apis/music.md)
- [密码强度检测接口](docs/apis/password-check.md)
- [随机密码生成接口](docs/apis/password-generator.md)
- [QQ 头像接口](docs/apis/qq-avatar.md)
- [短视频解析接口](docs/apis/short-video.md)
- [历史上的今天接口](docs/apis/today-in-history.md)

## 致谢

部分内置公开 API 基于或参考了以下项目：

- [emoji-aes](https://github.com/a8763506128977812212307169331690/emoji-aes)
- [taiji-encode](https://github.com/Cat7373/taiji-encode)
- [beast_sdk](https://github.com/SycAlright/beast_sdk)
- [Core-Values-Encoder](https://github.com/wTool/Core-Values-Encoder)
- [talk-with-buddha](https://github.com/takuron/talk-with-buddha)
- [sentences-bundle](https://github.com/hitokoto-osc/sentences-bundle)
- [60s](https://github.com/vikiboss/60s)
- [Meting](https://github.com/metowolf/Meting)
- [short_videos](https://github.com/jiuhunwl/short_videos)
- [media-parser](https://github.com/ucmao/media-parser)
- [60s-static-host](https://github.com/vikiboss/60s-static-host)
- [LanzouAPI](https://github.com/hanximeng/LanzouAPI)
- [v50](https://github.com/vikiboss/v50)

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。
