# 国内油价接口

`GET /v1/fuel-price` 查询国内地区油价，默认查询北京。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `region` | `北京` | 省、市或区县简称，例如 `杭州`、`西湖` |
| `encode` / `encoding` | `json` | `json`、`text`、`markdown` 或 `md` |
| `force-update` | `false` | `1`、`true`、`yes`、`y` 或 `on` 时绕过缓存 |

JSON 使用 Service 标准响应壳，`data` 包含地区、油价项目、调价趋势、来源链接和上海时区更新时间。地区不存在返回 `400 UNSUPPORTED_REGION`，上游请求或页面解析失败返回 `502 UPSTREAM_ERROR`。

结果按地区缓存 60 分钟，进程内最多保留 128 个地区。上游响应限制为 1 MiB且不跟随重定向；普通成功响应允许客户端缓存 1 小时，强制刷新响应使用 `no-store`。

## 地区列表

`GET /v1/fuel-price/regions` 返回完整地区表，可使用 `keyword` 过滤。它是 `/v1/fuel-price` 的支撑路由，Platform 会发现但不会将其展示成独立公共接口。
