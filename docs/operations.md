# API Service 运行维护

本文只说明已经部署完成后的日常操作。构建与首次部署见[构建与生产部署](deployment.md)，版本发布见[版本发布流程](release.md)。

## 1. 运行配置

Service 只公开三个部署环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_SERVICE_TOKEN` | 无 | 必填，至少 32 个字符；只用于 Platform → Service 认证和本地配置快照加密 |
| `LISTEN_ADDR` | `:8080` | 可选，格式为 `host:port`、`[ipv6]:port` 或单独端口 |
| `SERVICE_DATA_DIR` | 源码运行时为 `data`，官方镜像为 `/app/data` | 可选，Service 唯一的数据根目录 |

`.env.example` 只保留必填 Token。默认监听地址和官方镜像的数据目录已经适合常规部署，不需要重复填写。

`SERVICE_VERSION` 与 `SERVICE_COMMIT` 是官方镜像在构建阶段注入的观测信息，不属于管理员日常运行配置。Service 身份与名称是源码契约的一部分，第三方分支应在源码中明确修改，而不是在每个实例上通过环境变量产生不同身份。

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

模块不能再增加 `XXX_DATABASE_DIRECTORY`、`XXX_MODEL_PATH` 等环境变量。需要外挂、不能提交 Git 的数据库、模型、词典或证书包时，统一读取：

```text
<SERVICE_DATA_DIR>/assets/<module-id>/
```

例如 IP 模块固定读取：

```text
/app/data/assets/ip/cz88_public_v4.czdb
/app/data/assets/ip/cz88_public_v6.czdb
```

文件名和目录由模块源码定义，Platform 只管理业务开关与 Secret，不允许下发任意服务器文件路径。容器中建议把 `assets` 整体只读挂载，把 `runtime` 使用独立可写 Volume 持久化。

## 3. Platform 连接

Platform 不读取任何全局 Service Token 环境变量。每个 Internal Upstream 都在管理后台单独填写：

- 一个或多个 Target 地址。
- 该 Upstream 对应的 Service Token。
- 轮询或权重策略。

Token 由 Platform 使用自己的数据密钥加密保存。Service 端的 `API_SERVICE_TOKEN` 必须与该 Upstream 中保存的值相同。多个 Service 可以使用完全不同的地址和 Token。

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

更新 Service 不停止 Platform、Console、管理 API 或 External Route。单 Target 切换期间，依赖它的 Route 可能短暂返回 `503`；多个 Target 可以逐个替换并在 Platform 中观察健康状态。

回滚只需恢复上一版本镜像或 digest 后重新启动 Service。Service 回滚不执行 Platform 数据库迁移，也不修改 Platform Routing Revision。若新版本改变了 OpenAPI 或配置 Schema，回滚后应在 Platform 重新执行发现和配置同步。

## 6. Token 更换

`0.1.0` 不提供双 Token 在线轮换，也不公开 `API_SERVICE_PREVIOUS_TOKEN`。日常维护应保持 Token 稳定；只有泄露或环境迁移时才更换。

配置快照使用当前 Token 加密，因此更换 Token 时需要维护窗口：

1. 备份 `runtime/service-configuration.enc`，并确认 Platform 中保存的期望配置完整。
2. 暂停或禁用对应 Target。
3. 停止 Service，删除旧快照，设置新的 `API_SERVICE_TOKEN` 后重新启动。
4. 在 Platform 的对应 Internal Upstream 更新 Token。
5. 重新发现 Service，并把期望配置同步到全部 Target。
6. 验证业务 Route 后重新启用流量。

旧快照不能使用新 Token 解密；直接修改 Token 而保留快照会让 Service 以 `configuration file could not be decrypted` 拒绝启动。这是防止用错误密钥静默丢失业务 Secret 的 fail-closed 行为。
