# API Service 运行与发布

## 1. 运行配置

日常部署只需要设置 `API_SERVICE_TOKEN`；其余变量都有安全默认值，仅在部署拓扑或资源限制确实不同时覆盖。业务开关、Cookie、数据库授权密钥和算法配置不属于环境变量。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | 监听地址 |
| `API_SERVICE_TOKEN` | 无 | 必填，至少 32 个字符 |
| `API_SERVICE_PREVIOUS_TOKEN` | 空 | Token 轮换窗口上一值 |
| `READ_HEADER_TIMEOUT` | `5s` | Header 读取超时 |
| `REQUEST_TIMEOUT` | `20s` | 请求总 Deadline |
| `SHUTDOWN_TIMEOUT` | `10s` | 优雅退出预算 |
| `MAX_REQUEST_BODY_BYTES` | `1048576` | 请求体上限 |
| `IP_DATABASE_DIRECTORY` | `data/ip` | CZDB 挂载目录 |
| `SERVICE_CONFIG_FILE` | `data/runtime/service-configuration.enc` | AES-256-GCM 业务配置快照 |
| `SERVICE_ID` | `openapi-service` | 同一 Upstream 多 Target 的稳定服务身份 |
| `SERVICE_NAME` | `OpenAPI Service` | Platform 展示名称 |
| `SERVICE_VERSION` | `dev` | 观测版本 |
| `SERVICE_COMMIT` | `unknown` | 观测 Commit |

Service Token 等部署 Secret 只通过容器 Secret、部署面板或 CI/CD 注入。模块 Cookie、数据库授权密钥和算法配置由 Platform 加密保存并通过控制协议下发。
官方镜像在构建时写入 `SERVICE_VERSION` 与 `SERVICE_COMMIT`；常规部署无需手工配置这两个值。

## 2. 本地运行

```powershell
$env:API_SERVICE_TOKEN = 'replace-with-at-least-32-random-characters'
pnpm dev
```

## 3. 构建与部署

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm licenses:check
pnpm check:unused
```

`pnpm build` 只编译服务端 TypeScript。生产环境只运行预构建的 `dist/` 或镜像。

Service 在 Compose 中只暴露内部端口：

```text
http://openapi-service:8080
```

Service 的 `API_SERVICE_TOKEN` 必须与 Platform 对应 Internal Upstream 中加密保存的 Service Token 相同。每个 Internal Upstream 可以使用独立 Token，且不能复用用户 API Key。

## 4. CZDB

容器内默认读取：

```text
/app/data/ip/cz88_public_v4.czdb
/app/data/ip/cz88_public_v6.czdb
```

数据库文件通过只读 Volume 挂载，不提交 Git。目录属于部署配置；授权密钥 `ip.databaseKey` 只能由 Platform 通过业务配置协议下发并可热更新。

`SERVICE_CONFIG_FILE` 所在目录必须使用可写持久化 Volume。丢失快照后，Service 会回到 Schema 默认值，管理员需要从 Platform 重新同步期望配置。

## 5. 独立更新

```bash
docker compose pull openapi-service
docker compose up -d --no-deps openapi-service
```

更新 Service 不停止 Platform、Console、管理 API 或 External Route。依赖 Service 的 Route 在单实例切换时可以短暂返回 `503`，失败请求不得扣费。

## 6. Token 轮换

1. Service 同时配置新 Token 和 Previous Token。
2. 在 Platform 的 Upstream Service 管理页更新 Token。
3. 重新执行发现并确认 Platform 已使用新 Token。
4. 删除 Previous Token 并只重启 Service。

## 7. 回滚

Service 回滚只切换上一镜像 digest，不执行 Platform 数据库迁移，也不修改 Routing Revision。
