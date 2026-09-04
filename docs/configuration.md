# Service 业务配置协议

`openapi-service` 通过 `openapi-service/v1` 控制协议向 Platform 声明可管理的业务配置。Platform 不写死音乐、IP、Crypto 等模块名称，只读取 Schema、生成通用表单、加密保存期望值，并向同一 Upstream 的所有启用 Target 下发。

这套协议只用于保存后应立即生效的业务配置，不允许 Platform 指定 TypeScript 类名、服务器路径或任意代码。

控制协议版本与业务 Endpoint 路径版本独立。Service 可以在 `openapi-service/v1` 下同时暴露 `/v1/*` 与 `/v2/*`；只有发现、认证、配置 Schema 或配置同步语义本身发生破坏性变化时，才发布新的控制协议版本。

## 1. 三类配置

### Service 部署配置

只包含进程启动所需的最小边界：

- `API_SERVICE_TOKEN`
- `SERVICE_CONFIG_KEY`
- `SERVICE_ID`
- `SERVICE_NAME`
- `LISTEN_ADDR`
- `SERVICE_DATA_DIR`
- 网络、TLS、反向代理和容器资源限制

### Service 外挂数据

不能提交仓库的大文件统一挂载到：

```text
<SERVICE_DATA_DIR>/assets/<module-id>/
```

目录与文件名由模块源码固定声明，不进入配置 Schema，也不为每个模块增加环境变量。详细规范见[运行维护](operations.md#2-数据目录约定)。

### Platform 管理的业务配置

- 业务模块或来源开关。
- 音乐平台开关与 Cookie。
- IP 数据库授权密钥。
- Crypto 算法开关或允许列表。
- 适合热更新的业务超时、枚举和阈值。

这些字段由 Platform 加密保存并热更新，不进入任一仓库的 `.env`。

## 2. 控制端点

所有端点都只面向 Platform，并要求：

```http
Authorization: Service <token>
```

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/.well-known/service.json` | 服务身份、协议版本、OpenAPI 与配置端点指纹 |
| `GET` | `/.well-known/configuration-schema.json` | 声明通用配置表单 |
| `GET` | `/.well-known/configuration.json` | 返回当前 Revision、指纹和脱敏状态 |
| `PUT` | `/.well-known/configuration.json` | 幂等应用完整配置快照 |

这些控制端点返回可计算稳定 SHA-256 的协议文档，因此不套公共业务接口的 `code/message/data/timestamp` 响应壳。`/v{N}/*` 业务接口仍使用统一响应壳。

## 3. Schema

当前字段类型：

- `boolean`
- `text`
- `textarea`
- `secret`
- `number`
- `single-select`
- `multi-select`

字段 key 在整个 Service 内必须唯一。每一段以小写字母开头，后续可使用数字或 camelCase；段之间可使用 `.`, `_`, `-`。例如：

```text
ip.databaseKey
music.enabledPlatforms
music.neteaseCookie
crypto.allowedAlgorithms
shortVideo.enabledPlatforms
shortVideo.douyinCookie
```

示例定义：

```ts
export const serviceConfigurationDefinition = {
  schemaVersion: 1,
  groups: [
    {
      key: 'music',
      label: '音乐解析',
      fields: [
        {
          key: 'music.enabledPlatforms',
          type: 'multi-select',
          label: '可用音乐平台',
          default: ['netease'],
          options: [
            { value: 'netease', label: '网易云音乐' }
          ]
        },
        {
          key: 'music.neteaseCookie',
          type: 'secret',
          label: '网易云 Cookie',
          maxLength: 12_000
        }
      ]
    }
  ]
} as const satisfies ServiceConfigurationDefinition
```

Platform 只根据字段类型渲染控件。新增音乐来源或算法时，只修改 Service 定义并重新发布 Service；Platform 不增加业务专用页面或字段分支。

Revision `0` 是尚未由 Platform 保存的引导状态。Service 允许必填文本、Secret
或多选字段在该状态暂时为空，以保证控制端点可以启动并被发现；Platform
提交正式 Revision 时会严格执行 `required`、长度、范围和选项校验。依赖未配置
字段的业务模块应返回稳定 `503`，不能阻止其他模块和控制面启动。

## 4. 在 Service 中增加字段

1. 在模块自己的 `configuration.ts` 声明 group，并在 `src/modules/index.ts` 显式组合。
2. 在对应业务模块通过 `ServiceConfigurationManager.getValue()` 读取字段。
3. 如果资源需要热重载，通过 `subscribe()` 监听快照变化，并只重建受影响的本地资源。
4. 为默认值、非法值、热更新和 Secret 脱敏补测试。
5. 发布 Service 后，在 Platform 的 Upstream 管理页执行“发现 Service”。

当前 IP 模块是最小示例：

- `ip.enabled` 控制 `/v1/ip` 能力。
- `ip.databaseKey` 是由 Platform 管理的 Secret。
- 数据库文件固定来自 `assets/ip/`。
- 保存配置后，IP 数据库读取器在当前 Service 进程内更新，不要求重启。

模块 Route 与配置组必须继续在 `src/modules/index.ts` 显式组合。需要订阅配置或清理模块缓存时，由模块自己的 `index.ts` 封装，组合根不理解具体字段。禁止目录扫描、运行时业务模块加载或 Platform 下发模块路径。

## 5. Revision 与多 Target

Platform 是期望状态源：

1. 管理员保存时提交 `expectedRevision`。
2. Platform 使用乐观锁生成更大的 Revision，并计算配置 SHA-256。
3. Platform 向 Upstream 下所有启用 Target 下发同一完整快照。
4. Service 对相同 Revision + 相同指纹返回幂等 ACK；相同 Revision + 不同内容返回 `409`。
5. Platform 分别记录每个 Target 的 `synced`、`drifted`、`error` 或 `unknown` 状态。
6. 部分 Target 失败时，期望状态仍保留，管理员可在修复 Target 后执行“同步全部 Target”。

同一 Internal Upstream 的 Target 必须暴露相同的 `serviceId`、Service 名称、OpenAPI 指纹和配置 Schema 指纹。不同契约应创建不同 Upstream。

`SERVICE_ID` 是上述 `serviceId` 的部署值，不是实例编号。滚动部署中的 `3001`、`3002` 等副本必须使用相同值；不要把端口、主机名或容器编号拼入 `SERVICE_ID`。

## 6. Secret

- Platform 接收 Secret 后使用独立存储域加密落库。
- Platform 管理 API 只返回 `{ configured: true | false }`，从不回显明文。
- 下发时，明文只出现在经过 Service Token 认证的 Platform → Service 请求内；生产网络必须使用私网，跨不可信网络应增加 TLS/mTLS。
- Service 使用独立的 `SERVICE_CONFIG_KEY` 以 AES-256-GCM 加密 `runtime/service-configuration.enc`；Service Token 只负责请求认证。
- `GET /.well-known/configuration.json` 永远只返回 Secret 是否已配置。
- 清空 Secret 是显式操作；普通保存会保留已有值。
- 业务 Secret 不接受环境变量引导值，避免产生 Platform 与部署环境两个期望状态源。

日志、错误详情、OpenAPI 文档和配置 Schema 都不得包含 Secret 明文。

## 7. Platform 操作路径

1. 打开 `/admin/apis/upstreams`。
2. 创建 `internal` Upstream，填写 Service Target 和 Service Token。
3. 点击“管理”，进入 `/admin/apis/upstreams/:id`。
4. 点击“发现 Service”。Platform 会拉取服务描述、OpenAPI、配置 Schema 和脱敏状态。
5. 在自动生成的表单中修改字段并保存。
6. 查看每个 Target 的 Revision 与同步状态；故障恢复后可重新同步。

发现只更新契约和配置表单，不会自动把所有 Service Endpoint 公开到公网。公开路径、API Key、积分、限流和统计仍由 Platform Route 单独配置并通过 Routing Revision 发布。
