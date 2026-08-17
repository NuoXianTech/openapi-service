# 音乐解析接口

`GET /v1/music` 统一提供搜索、歌曲/专辑/歌手/歌单解析以及播放地址、封面和歌词资源。

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `server` | 否 | `netease` | `netease`、`tencent`、`kugou`、`baidu`（千千音乐）或 `kuwo` |
| `type` | 否 | `search` | `search`、`song`、`album`、`artist`、`playlist`、`url`、`lrc` 或 `pic` |
| `id` | 是 | - | 搜索关键词或对应类型的资源 ID |
| `page` | 否 | `1` | 仅 `search` 可用，范围 1 至 1000 |
| `limit` | 否 | `30` | 仅 `search`、`artist` 可用，范围 1 至 100 |

`id` 不会根据内容自动判断用途。即使 `id=29732992` 是纯数字，省略 `type` 时仍按关键词搜索；按歌曲 ID 查询必须显式传入 `type=song`。这样不会把数字歌名错误识别为歌曲 ID。

搜索与集合类型返回 Service 标准 JSON 响应壳。每首歌曲中的 `url`、`pic` 和 `lrc` 是指向 Platform 公网地址的可调用链接，不暴露内部 Service 地址。`type=url` 和 `type=pic` 返回 `302`，`type=lrc` 返回 `text/plain`。

音乐平台开关和各平台 Cookie 由 Service 配置 Schema 暴露给 Platform。Cookie 作为 secret 加密下发、持久化并脱敏回读，不使用环境变量，也不会出现在接口响应中。配置变更立即生效并清空进程内搜索缓存。

Service 只访问各音乐平台的固定上游地址，请求不跟随重定向并受统一截止时间约束。千千音乐和酷我音乐使用本仓库的内置实现，不依赖运行时 Provider 插件。
