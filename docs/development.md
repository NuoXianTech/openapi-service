# API Service 开发指南

## 1. 本地门禁

```bash
pnpm install --frozen-lockfile
pnpm licenses:check
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
pnpm measure:runtime
```

## 2. 变更归属

| 目标 | 修改位置 | 发布动作 |
| --- | --- | --- |
| 修改公开路径、鉴权、积分、限流或 Upstream | Platform | 发布 Routing Revision |
| 修改已声明的模块开关、Cookie、数据库密钥或算法列表 | Platform 的 Service 管理页 | 保存配置并热更新 |
| 修改 Token、挂载目录、网络或进程配置 | Service 部署环境 | 滚动重启 Service |
| 修改接口行为、参数、响应、配置 Schema 或依赖 | Service | 构建并发布 Service |

## 3. 新增接口

1. 定义稳定输入、输出和错误码。
2. 需要外部来源时建立普通 Source Client。
3. 使用 `createRoute` 与 Zod 定义 Endpoint。
4. 在 `src/modules/index.ts` 显式注册。
5. 补充单元、HTTP、Fixture 和 OpenAPI 测试。
6. 发布 Service。
7. 在 Platform 创建 Route 草稿并发布 Revision。

Platform 不会因为 Service 的 OpenAPI 新增 Endpoint 而自动公开它。

## 4. 新增业务配置

1. 在模块目录新增或修改 `configuration.ts`，由模块拥有字段语义。
2. 在 `src/modules/index.ts` 显式导入该配置组。
3. 在业务模块读取 `ServiceConfigurationManager`，需要时订阅热更新。
4. 补充字段校验、Secret 脱敏、Revision 和运行时生效测试。
5. 发布 Service 后，在 Platform 的 Internal Upstream 页面重新执行发现。
6. Platform 自动渲染新字段，不需要增加模块专用 Vue 页面或管理 API。

字段设计和音乐、IP、Crypto 示例见[业务配置协议](configuration.md)。

## 5. 删除接口

1. 先在 Platform 下线公开 Route 并发布 Revision。
2. 确认活动 Revision 不再引用该 Endpoint。
3. 从 Service 删除 Route、Module、资产和测试。
4. 发布新的 Service 镜像。

## 6. 测试要求

- HTTP Endpoint 至少覆盖成功和参数错误。
- 有外部来源时覆盖失败、超时、取消和脱敏 Fixture。
- 静态资产要验证固定版本、缓存头和 Content-Type。
- OpenAPI 测试必须确认删除的接口不会继续出现在契约中。
- 配置 Schema 必须覆盖重复 key、非法选项、Secret 不回显和热更新。
- 默认测试不得访问真实第三方网络。

## 7. 禁止项

- 运行时目录扫描、动态业务模块加载或任意脚本。
- 让 Platform 传入业务类名或模块路径，或在 Platform 硬编码音乐/IP/Crypto 专用字段。
- 为单个接口再拆第三个应用服务。
- 在没有第二个实际调用方前创建通用 Source Client、缓存或并发工具。
