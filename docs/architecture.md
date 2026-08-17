# OpenAPI Service 框架架构

## 1. 定位

`openapi-service` 是 Platform 官方维护的具体业务 API 上游。它使用 Node.js 24、TypeScript、Hono 和 Zod/OpenAPI，但始终是独立进程、镜像和发布单元。

Service 只实现业务 Endpoint，不管理 Platform 用户、公开 API Key、积分、公开路径或 Routing Revision。

## 2. 请求链路

```text
Node HTTP Adapter
  -> Request ID / Trace Context
  -> 结构化访问日志
  -> Service Token
  -> Body 上限与 Deadline
  -> Zod/OpenAPI 校验
  -> 业务 Module
  -> 本地数据或受控 Source Client
```

Platform 必须删除调用方的认证头和伪造 `x-openapi-*` 头，再注入：

```http
Authorization: Service <token>
X-Request-Id: ...
X-Forwarded-For: ...
X-OpenAPI-Route-Id: ...
```

## 3. 当前目录

```text
src/
├── index.ts
├── app.ts
├── config/
├── configuration/
├── contracts/
├── http/
├── modules/
│   └── <module>/
├── runtime/
├── shared/
└── types/

resources/
├── player/DPlayer.min.js
└── yiyan/*.json

data/                              # 本地忽略，不进入镜像源码层
├── assets/<module-id>/            # 运维方外挂只读数据
└── runtime/                       # Service 可写持久化状态

test/
├── public-routes.test.ts
├── ip-database.test.ts
├── system-routes.test.ts
├── request-pipeline.test.ts
├── http-smoke.test.ts
└── contracts/
```

`src/app.ts` 是应用组合根，`src/modules/index.ts` 是显式业务模块清单。二者都只在构建时组合已知模块，不扫描目录、不加载远程模块，也不接受 Platform 传入模块路径。

目录规则保持单向且最小：

- `config/` 只解析进程与部署环境；业务 Cookie、密钥和开关不得放入这里。
- `configuration/` 实现与业务无关的 Schema、快照、Revision、脱敏和持久化协议。
- `contracts/` 是 HTTP/OpenAPI 契约，`http/` 只处理传输层、中间件与错误映射。
- `modules/<name>/` 纵向拥有某个业务接口的 Route、业务逻辑、资产访问和可选配置声明。
- 仓库 `resources/` 只放允许随源码分发的内置资源；`SERVICE_DATA_DIR/assets/<module-id>` 只放运维外挂且不能提交 Git 的数据。二者不能互相回退或覆盖。
- `shared/` 只收纳至少已有两个生产调用方的无业务语义工具；没有第二个调用方时留在模块内。
- 禁止新增 Repository/Provider/Adapter 基类、运行时插件注册表或依赖注入容器；只有出现真实替换需求时才引入接口。

## 4. 业务模块

业务模块清单不在架构文档中重复维护。当前 Endpoint 以运行时 OpenAPI 为准，面向开发者的模块说明集中在 `docs/apis/`，README 只提供导航。新增模块仍必须在 `src/modules/index.ts` 显式注册并补齐测试与接口文档。

## 5. 契约与错误

业务 JSON 统一由 `respondWithSuccess` 或 `respondWithFailure` 返回，固定包含 `code/message/data/timestamp`。成功响应默认使用 `code=OK`、`message=请求成功`；错误响应额外返回 `X-OpenAPI-Error-Code`，供 Platform 在不读取或缓冲响应体的情况下记录稳定错误码。

Zod Schema 是请求、响应和 OpenAPI 的单一来源。未知异常只公开稳定的 `INTERNAL_ERROR`；日志不得输出 Token、Cookie、数据库密钥、完整签名 URL或第三方响应正文。

OpenAPI 文档确定性排序并计算 SHA-256。指纹变化只表示 Service 契约变化，不会自动修改 Platform 的活动 Route。

Platform 按 Operation 的第一个非 `System` Tag 组织 Product。同一业务的多个
Operation 应共享该 Tag。只为公开 Operation 提供资产或内部依赖的 Operation
使用 `x-openapi-platform.support=true`；它仍经过 Gateway 转发，但由 Platform
隐藏并随同组公开 Route 自动启停，不形成可独立治理的公共接口。

## 6. 业务配置控制面

需要业务配置的模块在自己的 `src/modules/<module>/configuration.ts` 声明字段，`src/modules/index.ts` 与 Route 一起显式组合。Service 通过受 Service Token 保护的 well-known 端点暴露 Schema、脱敏状态和更新入口。Platform 只理解通用字段类型，不理解 IP、音乐或 Crypto 业务语义。

配置采用完整快照、单调 Revision 和 SHA-256 ACK。Secret 在 Platform 数据库和 Service 本地快照中分别加密，读取协议只返回是否已配置。一个 Upstream 的多个 Target 必须具有相同 Service 契约，Platform 会统一下发并分别记录漂移状态。

这仍然是显式静态组合：新增字段必须修改模块源码、组合清单和测试；不会扫描目录或加载远程模块。完整协议见[业务配置协议](configuration.md)。

## 7. 构建边界

| 变更 | 是否 Build | 生效方式 |
| --- | --- | --- |
| Platform 的公开路径、鉴权、积分、限流、启停和删除 | 否 | 发布 Routing Revision |
| 已声明的模块开关、Cookie、数据库密钥和算法列表 | 否 | Platform 保存并热更新 Service |
| Service Token、统一数据根目录、网络和进程配置 | 否 | 滚动重启 Service |
| Endpoint、业务逻辑、OpenAPI、配置 Schema 和依赖 | 是，仅 Service | 构建并替换 Service 镜像 |

官方容器部署不在生产服务器执行 `pnpm install`、TypeScript Build 或 Nuxt Build。非容器 Release 包只需安装锁定的生产依赖，不再编译源码。
