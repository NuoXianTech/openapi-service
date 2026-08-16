# Service 业务配置协议

`openapi-service` 通过 `openapi-platform-service/v1` 协议向 Platform 声明可管理的业务配置。Platform 不写死音乐、IP、Crypto 等模块名称，只读取 Schema、生成通用表单、加密保存期望值，并向同一 Upstream 的所有启用 Target 下发。

这套协议用于“修改后应立即生效”的业务配置，不允许 Platform 指定 TypeScript 类名、文件路径或任意代码。

## 1. 配置边界

继续由部署环境管理、通常需要重启 Service 的配置：

- `LISTEN_ADDR`、超时和请求体上限。
- `API_SERVICE_TOKEN`、`API_SERVICE_PREVIOUS_TOKEN`。
- `SERVICE_ID`、`SERVICE_NAME`、版本和 Commit。
- `SERVICE_CONFIG_FILE`、IP 数据库目录、只读数据 Volume。
- 网络、代理、证书和容器资源限制。

由 Platform 管理、保存后无需重启 Service 的业务配置：

- 业务模块或来源开关。
- 音乐平台开关与 Cookie。
- IP 数据库授权密钥。
- Crypto 算法开关或允许列表。
- 适合热更新的业务超时、枚举和阈值。

不要把文件目录、端口、任意模块路径或脚本内容声明成业务配置字段。

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

这些端点返回可计算稳定 SHA-256 的协议文档，因此不套公共业务接口的 `code/message/data/timestamp` 响应壳。`/v1/*` 业务接口仍使用统一响应壳。

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
music.netease.enabled
music.netease.cookie
crypto.enabledAlgorithms
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
          key: 'music.netease.enabled',
          type: 'boolean',
          label: '启用网易云音乐',
          default: true
        },
        {
          key: 'music.netease.cookie',
          type: 'secret',
          label: '网易云 Cookie',
          maxLength: 16_384
        }
      ]
    },
    {
      key: 'crypto',
      label: '加密与编码',
      fields: [
        {
          key: 'crypto.enabledAlgorithms',
          type: 'multi-select',
          label: '启用算法',
          default: ['base64'],
          options: [
            { label: 'Base64', value: 'base64' },
            { label: 'Morse', value: 'morse' }
          ]
        }
      ]
    }
  ]
} as const satisfies ServiceConfigurationDefinition
```

Platform 只根据字段类型渲染控件。以后新增音乐来源或算法时，只修改 Service 定义并重新发布 Service；Platform 不新增业务专用页面或字段分支。

## 4. 在 Service 中增加字段

1. 在模块自己的 `configuration.ts` 声明 group，并在 `src/modules/index.ts` 显式组合。
2. 在对应业务模块通过 `ServiceConfigurationManager.getValue()` 读取字段。
3. 如果资源需要热重载，通过 `subscribe()` 监听快照变化，并只重建受影响的本地资源。
4. 为默认值、非法值、热更新和 Secret 脱敏补测试。
5. 发布 Service 后，在 Platform 的 Upstream 管理页执行“发现 Service”。

当前 IP 模块就是最小示例：

- `ip.enabled` 控制 `/v1/ip` 能力。
- `ip.databaseKey` 是 Secret。
- `IP_DATABASE_DIRECTORY` 仍属于部署配置。
- 保存配置后，IP 数据库读取器在当前 Service 进程内更新，不要求重启。

模块 Route 与配置组必须继续在 `src/modules/index.ts` 显式组合。禁止目录扫描、运行时业务模块加载或 Platform 下发模块路径。

## 5. Revision 与多 Target

Platform 是期望状态源：

1. 管理员保存时提交 `expectedRevision`。
2. Platform 使用乐观锁生成更大的 Revision，并计算配置 SHA-256。
3. Platform 向 Upstream 下所有启用 Target 下发同一完整快照。
4. Service 对相同 Revision + 相同指纹返回幂等 ACK；相同 Revision + 不同内容返回 `409`。
5. Platform 分别记录每个 Target 的 `synced`、`drifted`、`error` 或 `unknown` 状态。
6. 部分 Target 失败时，期望状态仍保留，管理员可在修复 Target 后执行“同步全部 Target”。

同一 Internal Upstream 的 Target 必须暴露相同的 `serviceId`、OpenAPI 指纹和配置 Schema 指纹。不同契约应创建不同 Upstream。

## 6. Secret

- Platform 接收 Secret 后使用独立存储域加密落库。
- Platform 管理 API 只返回 `{ configured: true | false }`，从不回显明文。
- 下发时，明文只出现在经过 Service Token 认证的 Platform → Service 请求内；生产网络必须使用私网，跨不可信网络应增加 TLS/mTLS。
- Service 使用 AES-256-GCM 加密 `SERVICE_CONFIG_FILE` 快照。
- `GET /.well-known/configuration.json` 永远只返回 Secret 是否已配置。
- 清空 Secret 是显式操作；普通保存会保留已有值。
- 业务 Secret 不接受环境变量引导值，避免产生 Platform 与部署环境两个期望状态源。
- Token 轮换期间配置 `API_SERVICE_PREVIOUS_TOKEN`，Service 可用旧 Token 解密已有快照并用新 Token 继续运行。

日志、错误详情、OpenAPI 文档和配置 Schema 都不得包含 Secret 明文。

## 7. Platform 操作路径

1. 打开 `/admin/apis/upstreams`。
2. 创建 `internal` Upstream，填写 Service Target 和 Service Token。
3. 点击“管理”，进入 `/admin/apis/upstreams/:id`。
4. 点击“发现 Service”。Platform 会拉取服务描述、OpenAPI、配置 Schema 和脱敏状态。
5. 在自动生成的表单中修改字段并保存。
6. 查看每个 Target 的 Revision 与同步状态；故障恢复后可重新同步。

发现只更新契约和配置表单，不会自动把所有 Service Endpoint 公开到公网。公开路径、API Key、积分、限流和统计仍由 Platform Route 单独配置并通过 Routing Revision 发布。
