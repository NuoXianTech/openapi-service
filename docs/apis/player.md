# 播放器 HTML 公共接口

播放器接口根据视频 URL 生成可嵌入页面的 HTML，不代理或下载视频内容。

## DPlayer

`GET /v1/player` 使用仓库内置的定制 DPlayer：

```text
DPlayer 1.27.2 / nuoxi4n
/v1/player/assets/dplayer-1.27.2-nuoxi4n.min.js
```

该文件位于 `assets/player/DPlayer.min.js`，不是 npm 官方 `dplayer` 包。

主要参数：`url`、`type`、`cover`、`live`、`muted`、`autoplay`、`hideplay`、`loop`、`lang` 和 `volume`。

## ArtPlayer

`GET /v1/player/art` 使用固定版本 ArtPlayer，支持 `url`、`type`、`poster`、`theme`、`volume` 及播放器行为开关。

## 浏览器资产

```text
GET /v1/player/assets/{asset}
```

资产响应使用长期 immutable 缓存。Platform 中该 Route 必须配置为：

```text
isApiKey = false
creditsCost = 0
isStatistics = false（推荐）
```

否则浏览器加载 `<script>` 时无法携带用户 API Key。

播放器启停由 Platform 分别启停 `/v1/player`、`/v1/player/art` 和资产 Route 完成，Service 不存在“播放器接口能力配置”。播放器 HTML 自己返回所需 CSP 和安全响应头。
