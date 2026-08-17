# Epic 免费游戏接口

`GET /v1/epic` 获取 Epic Games 商店中国区当前正在免费和即将免费的游戏。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 成功响应的 `data` 是游戏数组，使用 Service 标准响应壳。`is_free_now` 表示当前是否处于免费领取期；`free_start` 和 `free_end` 使用上海时区，配套的 `*_at` 是 Unix 毫秒时间戳。

```json
{
  "code": "OK",
  "message": "获取 Epic 免费游戏成功",
  "data": [{
    "id": "example-id",
    "title": "示例游戏",
    "cover": "https://cdn1.epicgames.com/example.jpg",
    "original_price": 62,
    "original_price_desc": "¥62.00",
    "description": "游戏简介",
    "seller": "示例发行商",
    "is_free_now": true,
    "free_start": "2026-07-30 23:00:00",
    "free_start_at": 1785423600000,
    "free_end": "2026-08-06 23:00:00",
    "free_end_at": 1786028400000,
    "link": "https://store.epicgames.com/zh-CN/p/example"
  }],
  "timestamp": 1786924800000
}
```

Service 固定访问 Epic Games Store 中国区公开接口，上游响应限制为 2 MiB且不跟随重定向。数据缓存 10 分钟，成功响应允许客户端缓存 5 分钟；上游请求或数据解析失败时返回 `502 UPSTREAM_ERROR`。
