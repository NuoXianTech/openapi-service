# 密码强度检测接口

`POST /v1/password/check` 在 Service 进程内分析密码长度、字符类型、常见模式和估算强度，不访问上游服务。

请求体必须是 `{ "password": "..." }`，密码最多 128 个 Unicode 码点。Service 不会对密码执行 `trim` 或 Unicode 归一化。

| Query 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 使用标准响应壳，`data` 包含评分、强度、估算熵值、字符分析、改进建议和安全提示。响应不会包含被检测的明文密码。

该接口只接受 POST JSON body，避免密码进入 URL 与 Platform Query 日志；单次请求体限制为 32 KiB，所有响应均为 `Cache-Control: no-store`。Service 不记录请求体、不缓存密码，也不查询密码泄露库。强度与破解时间只是粗略估算，不能代替泄露检查。
