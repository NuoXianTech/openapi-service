# 今日运势接口

`GET /v1/luck` 从内置数据集中随机返回一条今日运势。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `id` | 随机 | 类别 ID，支持 `0` 至 `18` |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 使用 Service 标准响应壳，`data` 包含类别 ID、名称、运势值、提示内容和提示索引。`rank` 沿用数据集原始值，不是十分制评分。

接口不访问外部服务，每次随机选择提示并返回 `Cache-Control: no-store`。格式错误的 ID 返回 `400 INVALID_ID`，超出范围返回 `404 LUCK_NOT_FOUND`。
