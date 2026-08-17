# 历史上的今天接口

`GET /v1/today-in-history` 查询指定月日的历史事件，数据来自百度百科公开的月度历史事件数据。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `date` | 上海时区当天 | `MM-DD` 或 `YYYY-MM-DD`，年份只用于日期合法性校验 |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |

JSON 使用标准响应壳，事件类型为 `birth`、`death` 或 `event`。上游 HTML 文本会转为纯文本，重复事件会被移除，链接只保留 `baike.baidu.com` HTTPS 地址；Markdown 输出会转义上游内容。

Service 通过安全请求器访问固定百度百科域名，月度响应限制为 4 MiB。每月数据在进程内缓存一天并合并并发请求，最多只会保存 12 个月；公开响应允许缓存一小时。
