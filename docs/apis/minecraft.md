# Minecraft 玩家资料接口

`GET /v1/minecraft` 查询 Minecraft Java 版玩家资料、皮肤和披风。

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | - | 3 至 16 位用户名、32 位 UUID 或带连字符 UUID |
| `type` | 否 | `json` | `json` 返回资料；`skin` 或 `cape` 返回 302 |

兼容 `skin_url` 和 `skin_cloak`，分别等价于 `skin` 和 `cape`。JSON 使用 Service 标准响应壳，UUID 始终为 32 位小写格式。没有对应纹理时字段为 `null`，直接请求纹理则返回稳定的 `404` 错误码。

接口只访问 Mojang Profile API 和 Session Server，纹理地址统一为 HTTPS 且必须属于 `textures.minecraft.net`。结果按玩家缓存 5 分钟，进程内最多保存 256 项；成功响应允许客户端缓存 5 分钟。上游响应限制为 64 KiB且不跟随重定向。
