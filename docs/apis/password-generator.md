# 随机密码生成接口

`GET /v1/password` 使用 Node.js 密码学安全随机数在 Service 本地生成密码，不请求上游服务。

| Query 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `length` | `16` | 4 至 128 之间的整数 |
| `mode` | `strong` | `strong`、`alphanumeric` 或 `numeric` |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

`strong` 保证小写、大写、数字和符号各至少一个；`alphanumeric` 保证小写、大写和数字各至少一个；`numeric` 只生成数字。所有模式排除 `0/O/o`、`1/I/l` 等易混淆字符。

实现使用 `node:crypto` 的 `randomInt` 取样和安全 Fisher-Yates 洗牌，不使用 `Math.random()`。响应设置 `Cache-Control: no-store`，Service 不缓存也不主动记录生成的密码。JSON 输出使用标准响应壳。
