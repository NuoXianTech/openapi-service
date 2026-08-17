# 贵金属价格接口

`GET /v1/gold-price` 获取贵金属实时行情、主要金店黄金价格、银行金条价格和贵金属回收价格。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 使用 Service 标准响应壳。`data.metals`、`stores`、`banks` 和 `recycle` 分别包含四组行情；无法取得的价格显示为 `N/A`。时间文本采用上海时区，`updated_at` 为 Unix 毫秒时间戳。

行情来自金投网公开使用的固定 HTTPS 接口。Service 对脚本外壳和 JSON 内容做严格解析，上游响应限制为 512 KiB且不跟随重定向。数据缓存 2 分钟，成功响应允许客户端缓存 1 分钟；上游请求、脚本格式或数据解析失败返回 `502 UPSTREAM_ERROR`。
