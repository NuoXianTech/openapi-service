# Bing 每日壁纸接口

`GET /v1/bing` 获取 Bing 每日壁纸元数据或图片地址。

## 请求参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown`、`md`、`image` 或 `image-4k` |
| `type` | `auto` | `auto`、`pc` 或 `mobile`；`auto` 根据 User-Agent 选择尺寸 |

JSON 响应使用 Service 标准响应壳。`data.cover` 是按 `type` 选择的图片地址，`data.cover_4k` 始终是 UHD 图片地址。

```json
{
  "code": "OK",
  "message": "获取必应每日壁纸成功",
  "data": {
    "title": "示例标题",
    "headline": "示例标题",
    "description": "示例描述",
    "cover": "https://bing.com/th?id=OHR.Example_1920x1080.jpg",
    "cover_4k": "https://bing.com/th?id=OHR.Example_UHD.jpg",
    "main_text": "示例正文",
    "copyright": "示例版权",
    "update_date": "2026-08-17 08:00:00",
    "update_date_at": 1786924800000
  },
  "timestamp": 1786924800000
}
```

`text` 返回 `cover` 地址，`markdown` 与 `md` 返回 Markdown。`image` 以 `302` 跳转到 `cover`，`image-4k` 跳转到 `cover_4k`。

## 数据来源与缓存

Service 优先解析 Bing 中文首页，失败时回退到 Bing 图片归档接口。成功结果按上海日期缓存；当天刷新失败但仍有历史成功结果时继续返回旧缓存。客户端成功响应可缓存一小时。

两个上游响应均有大小限制且不跟随重定向。所有图片地址必须使用 HTTPS 并属于 `bing.com`，上游全部不可用时返回 `502 UPSTREAM_ERROR`。
