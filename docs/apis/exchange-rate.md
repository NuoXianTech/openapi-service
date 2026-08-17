# 汇率接口

`GET /v1/exchange-rate` 查询指定基准货币的最新汇率。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `currency` | `CNY` | ISO 4217 三位货币代码，不区分大小写 |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 使用 Service 标准响应壳，`data` 包含基准货币、上次与下次更新时间和全部有效汇率。时间文本使用上海时区，`*_at` 为 Unix 毫秒时间戳。

Service 固定访问 `https://open.er-api.com/v6/latest/{currency}`，响应限制为 512 KiB且不跟随重定向。每个货币的结果缓存 6 小时，进程内最多保留 32 个货币；成功响应允许客户端缓存 1 小时。参数错误返回 `400 INVALID_CURRENCY`，上游错误返回 `502 UPSTREAM_ERROR`。
