# API Service 运行维护

本文只说明已经部署完成后的日常操作。构建与首次部署见[构建与生产部署](deployment.md)，版本发布见[版本发布流程](release.md)。

## 1. 运行配置

Service 只公开六个部署环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_SERVICE_TOKEN` | 无 | 必填，至少 32 个字符；只用于 Platform → Service 请求认证 |
| `SERVICE_CONFIG_KEY` | 无 | 必填，独立的 32-byte 密钥；支持 64 位 hex、base64url 或恰好 32-byte UTF-8，用于本地配置快照加密 |
| `SERVICE_ID` | `openapi-service` | 稳定的服务契约身份；同一 Internal Upstream 的全部 Target 必须一致 |
| `SERVICE_NAME` | `OpenAPI Service` | Platform 发现后展示的服务名称；同一 Internal Upstream 的全部 Target 必须一致 |
| `LISTEN_ADDR` | `:8080` | 可选，格式为 `host:port`、`[ipv6]:port` 或单独端口 |
| `SERVICE_DATA_DIR` | 源码运行时为 `data`，官方镜像为 `/app/data` | 可选，Service 唯一的数据根目录 |

源码方式启动时，可从 `.env.example` 复制以下完整运行配置：

```dotenv
API_SERVICE_TOKEN=replace-with-at-least-32-random-characters
SERVICE_CONFIG_KEY=replace-with-an-independent-64-character-hex-value
SERVICE_ID=openapi-service
SERVICE_NAME=OpenAPI Service
LISTEN_ADDR=:8080
SERVICE_DATA_DIR=data
```

`LISTEN_ADDR` 接受 `:8080`、`127.0.0.1:8080`、`8080` 或 `[::1]:8080`。使用官方 Docker 镜像时保留镜像内的 `:8080` 与 `/app/data` 默认值即可；Compose 已将外挂资产和运行快照挂载到 `/app/data` 对应目录。

`.env.example` 列出以上六个管理员可配置项。`SERVICE_CONFIG_KEY` 必须与 `API_SERVICE_TOKEN` 分别生成，并与运行快照一起备份；已有快照后不能直接替换。`SERVICE_ID` 只允许小写字母、数字以及分隔符 `.`, `_`, `-`，最大 120 个字符。它同时参与配置快照归属和 Platform 契约校验：同一 Internal Upstream 的全部 Target 必须使用相同值；已有快照或已经被 Platform 发现后不得随意修改。`SERVICE_NAME` 是展示名称，最大 160 个字符。

`SERVICE_VERSION` 与 `SERVICE_COMMIT` 是构建阶段写入 `dist/build-info.json` 的观测信息，官方镜像和 GitHub Release 预构建包都会携带。它们不属于管理员日常运行配置，因此不放入模板；仅在自定义构建确有需要时才通过同名环境变量显式覆盖。

以下限制固定在代码中，不再暴露环境变量：

- Header 读取超时：5 秒。
- 请求总超时：20 秒。
- 优雅退出预算：10 秒。
- 请求体上限：1 MiB。

它们是所有官方 Endpoint 的统一安全边界。确需改变时应修改源码、补测试并发布新版本，避免不同实例因环境变量漂移而表现不一致。

## 2. 数据目录约定

`SERVICE_DATA_DIR` 下只定义两个一级目录：

```text
<SERVICE_DATA_DIR>/
├─ assets/                         # 运维方提供，只读
│  └─ <module-id>/                 # 每个模块一个固定目录
└─ runtime/                        # Service 生成，可写且持久化
   └─ service-configuration.enc    # Platform 下发的加密配置快照
```

仓库根目录的 `resources/` 是允许随源码和镜像发布的内置只读资源，例如定制 DPlayer 和一言数据；它不属于 `SERVICE_DATA_DIR`。`SERVICE_DATA_DIR/assets/` 是唯一的运维外挂入口，只存放 CZDB 等不能提交 Git 或不能随镜像分发的数据。

`runtime/service-configuration.enc` 是 Service 自动生成的本地配置快照。Platform 仍是唯一的期望状态源；当管理员保存音乐 Cookie、IP 数据库密钥、算法开关等业务配置时，Service 在应用配置后把最后一次成功的完整 Revision 写入该文件。这样 Service 单独重启或滚动升级时不必等待 Platform 再次下发，就能恢复原有业务配置。

快照可能包含 Secret，因此使用独立的 `SERVICE_CONFIG_KEY` 派生密钥并以 AES-256-GCM 加密，文件权限会尽量收紧为仅当前进程用户可读写。它不需要手工创建或编辑，但必须放在各实例独立的可写持久化目录。删除快照不会删除 Platform 中加密保存的期望配置；Service 会以默认配置启动，管理员需要在 Platform 执行“同步全部 Target”重新生成快照后再让该 Target 承载流量。

模块不能再增加 `XXX_DATABASE_DIRECTORY`、`XXX_MODEL_PATH` 等环境变量。需要外挂、不能提交 Git 的数据库、模型、词典或证书包时，统一读取：

```text
<SERVICE_DATA_DIR>/assets/<module-id>/
```

例如 IP 模块固定读取：

```text
data/assets/ip/cz88_public_v4.czdb       # SERVICE_DATA_DIR=data
data/assets/ip/cz88_public_v6.czdb
/app/data/assets/ip/cz88_public_v4.czdb  # 官方容器
/app/data/assets/ip/cz88_public_v6.czdb
```

文件名和目录由模块源码定义，Platform 只管理业务开关与 Secret，不允许下发任意服务器文件路径。容器中建议把 `assets` 整体只读挂载，把 `runtime` 使用独立可写 Volume 持久化。

## 3. Platform 连接

Platform 不读取任何全局 Service Token 环境变量。每个 Internal Upstream 都在管理后台单独填写：

- 一个或多个 Target 地址。
- 该 Upstream 对应的 Service Token。
- 轮询或权重策略。

Token 由 Platform 使用自己的数据密钥加密保存。Service 端的 `API_SERVICE_TOKEN` 必须与该 Upstream 中保存的值相同。多个 Service 可以使用完全不同的地址和 Token。

同一 Internal Upstream 的多个 Target 是同一个服务契约的副本。例如同一主机上的 `http://127.0.0.1:3001` 与 `http://127.0.0.1:3002` 必须使用相同的 `SERVICE_ID`、`SERVICE_NAME` 和 `API_SERVICE_TOKEN`。每个进程使用独立的可写 `SERVICE_DATA_DIR/runtime`；副本可以使用不同的 `SERVICE_CONFIG_KEY`，但每个密钥都必须随对应运行快照备份。较大的外挂数据可以把同一宿主机目录分别只读挂载到各实例的 `SERVICE_DATA_DIR/assets`。

Platform 发现时还会校验 `serviceProtocol`。当前 Service 声明 `openapi-service/v1`；该值不是软件版本，也不限制 OpenAPI 中只能出现 `/v1`。Platform 与 Service 版本号不同只要协议受支持且集成测试通过即可组合部署。

## 4. 健康检查

```text
GET /healthz
GET /readyz
```

两个端点可在内部网络免 Token 访问。业务模块缺少外挂文件时，该模块应返回稳定的 `503`，不应让无关模块或整个进程退出。

## 5. 独立升级与回滚

使用 Service 仓库提供的 Compose：

```bash
docker compose pull
docker compose up -d --no-deps openapi-service
docker compose ps
```

更新 Service 不停止 Platform、Console、管理 API 或 External Route。多个兼容 Target 可以依次滚动更新：

1. 在 Platform 禁用第一个 Target，确认至少一个已同步 Target 继续承载流量。
2. 停止、替换并启动该 Service，检查 `/healthz` 与 `/readyz`。
3. 启用该 Target，在“管理 Service”中重新发现并同步全部 Target。
4. 等待该 Target 显示为已同步后，再用相同步骤更新下一个 Target。

启用内部 Target 不会立刻把它加入活动路由；发现和配置同步用于验证它与当前契约一致。Service 软件发布版本不参与协议兼容判断或 OpenAPI 指纹，未改变 OpenAPI 与配置 Schema 的版本可以直接滚动更新。若新版本改变任一指纹，应创建新的 Internal Upstream 做蓝绿迁移，不能让不同契约的节点同时属于同一 Upstream。

回滚只需恢复上一版本镜像或 digest 后重新启动 Service。Service 回滚不执行 Platform 数据库迁移，也不修改 Platform Routing Revision。若新版本改变了 OpenAPI 或配置 Schema，回滚后应在 Platform 重新执行发现和配置同步。

## 6. Token 更换

`0.1.0` 不提供双 Token 在线轮换，也不公开 `API_SERVICE_PREVIOUS_TOKEN`。日常维护应保持 Token 稳定；只有泄露或环境迁移时才更换。

配置快照不再使用 Token 加密，因此只更换 `API_SERVICE_TOKEN` 不会影响已有快照。Token 更换仍需要维护窗口，以同步更新 Service 与 Platform：

1. 暂停或禁用对应 Target。
2. 停止 Service，设置新的 `API_SERVICE_TOKEN` 后重新启动；保持 `SERVICE_CONFIG_KEY` 不变。
3. 在 Platform 的对应 Internal Upstream 更新 Token。
4. 重新发现 Service 并验证连接。
5. 验证业务 Route 后重新启用流量。

`SERVICE_CONFIG_KEY` 是长期数据密钥，不应跟随 Token 轮换。直接修改它而保留快照会让 Service 以 `configuration file could not be decrypted` 拒绝启动；当前版本不提供在线重加密或 Keyring。
