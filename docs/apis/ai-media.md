# AI 媒体解析与去水印接口

按平台提供六个独立的 `GET` 接口，统一使用 `/v1/ai-media/<平台>` 路径，解析 AI 创作平台的图片和视频分享，优先返回平台提供的原图、原视频或下载地址。每个接口均接受 `url=<分享链接或完整分享文案>`，最长 4096 字符，需要 URL 编码。

| 平台 | 接口路径 | OpenAPI Tag |
| --- | --- | --- |
| 豆包 | `/v1/ai-media/doubao` | `Doubao Media` |
| 即梦 | `/v1/ai-media/jimeng` | `Jimeng Media` |
| 小云雀 | `/v1/ai-media/xiaoyunque` | `Xiaoyunque Media` |
| 可灵 | `/v1/ai-media/kling` | `Kling Media` |
| 海螺 | `/v1/ai-media/hailuo` | `Hailuo Media` |
| 通义千问 | `/v1/ai-media/qianwen` | `Qianwen Media` |

这些是 OpenAPI 中六条固定路径，各有独立的 `operationId` 和业务 Tag，Platform 会为它们创建独立接口目录项。提交链接必须属于路径指定的平台，否则返回 `400 AI_MEDIA_PLATFORM_MISMATCH`，不访问上游。

与其他业务接口一致，ai-media 不额外设置 `summary`。Platform 的接口列表使用具体的 `operationId`，如 `parseDoubaoMedia`、`parseJimengMedia`；中文平台名称用于业务配置和用户提示。

接口按平台提供的媒体版本选择结果，不执行图片修补、视频裁剪或像素级水印消除。`variant` 表示媒体版本，`watermark` 表示无水印、AI 生成角标、已知水印或未知状态，二者独立。

## 调用

```bash
curl --get 'http://127.0.0.1:8080/v1/ai-media/doubao' \
  --header 'Authorization: Service <token>' \
  --data-urlencode 'url=https://www.doubao.com/thread/<分享ID>'
```

成功响应使用 Service 的标准响应壳：

```json
{
  "code": "OK",
  "message": "解析成功",
  "data": {
    "author": "创作者",
    "uid": "123",
    "avatar": null,
    "title": "海边日落",
    "cover": "https://image.example.com/original.png",
    "media": [
      {
        "type": "image",
        "url": "https://image.example.com/original.png",
        "variant": "original",
        "watermark": "none"
      }
    ]
  },
  "timestamp": 1788768000000
}
```

六个接口共用一个响应 Schema。`data` 固定包含 `author`、`uid`、`avatar`、`title`、`cover`、`media`；作者名称、标识、头像使用平铺字段。路径已经确定平台，响应不再重复返回 `platform`。成功响应也不返回 `warnings` 文案，调用方通过每项媒体的 `variant` 和 `watermark` 判断可用版本与水印状态。

缺失标量使用 `null`，不使用空字符串或虚构默认标题。`author` 是作者名称字符串，`uid` 是作者 ID 字符串，`avatar` 是头像地址，三者独立取值；例如只有作者 ID 时仍保留 `uid`，另外两个字段为 `null`。媒体、封面和头像地址仅允许 HTTP(S)。

即使上游将 UID 返回为整数，`uid` 也统一输出字符串，例如 `42` 返回为 `"42"`。JSON 接口和页面内嵌 JSON 都会在解码时保留超出 JavaScript 安全整数范围的整数字面量，避免 64 位 UID 被舍入；已有字符串中的前导零和字母同样保留。不可用的 UID 返回 `null`。

`media` 保留同一分享内的多个视频和图片，按类型和地址去重并保留解析顺序；封面和头像使用独立字段。海螺的 `originFiles` 是输入参考图，不混入视频结果。豆包对话分享同时支持创作、图片附件与引用图片。没有媒体时返回错误，不返回空列表或 `data: null` 的成功响应。

| 字段 | 取值与含义 |
| --- | --- |
| `author` | 作者名称，未知时为 `null` |
| `uid` | 作者 ID，统一使用字符串，未知时为 `null` |
| `avatar` | 作者头像地址，未知时为 `null` |
| `title` | 作品标题或描述，未知时为 `null` |
| `cover` | 作品封面；缺失时使用第一张结果图片，没有图片时为 `null` |
| `media[].type` | `image` 或 `video` |
| `media[].url` | 媒体资源地址；CDN 签名查询字符串原样保留，地址可能过期 |
| `media[].variant` | `original`：原始字段/原片请求；`download`：下载或作品资源；`preview`：预览回退 |
| `media[].watermark` | `none`：原始字段/原片请求表明无水印，且 URL 无已知水印标记；`ai-generated`：保留 AI 生成角标；`present`：已知带水印；`unknown`：上游不足以判断 |

`watermark` 根据上游字段和 URL 推断，未执行像素检测。`variant=original` 与 `watermark=present` 可以同时出现：部分平台把带水印地址放在原始字段中。调用方如要求无水印，应筛选 `watermark=none`，并根据用途检查实际媒体。`unknown` 不等于无水印；登录态不可用但存在公开预览时仍返回可用媒体及其实际状态，完全无法取得媒体时返回标准错误。

### 开发线契约调整

ai-media 在 `v0.1.3` 标签之后加入，尚未包含在已打标签的正式版本中。本次直接整理这组接口的初始 `/v1` 契约；使用此前开发镜像的调用方需要更新字段读取方式，并在 Platform 重新发现 Service 以刷新 OpenAPI：

| 旧字段 | 当前字段或处理方式 |
| --- | --- |
| `data.platform` | 移除，平台由请求路径确定 |
| `data.warnings` | 移除，通过媒体的版本和水印状态处理结果 |
| `data.author.name` | `data.author`，作者名称字符串 |
| `data.author.id` | `data.uid` |
| `data.author.avatar` | `data.avatar` |
| `data.media[].source` | `data.media[].variant` |
| 未知信息的空字符串、默认标题 | `null` |

正式发布后，破坏性响应调整按开发指南新增业务版本，不原地更改已发布契约。

## 平台能力

| 平台 | 解析流程 | 当前能力与边界 |
| --- | --- | --- |
| 豆包 | `/thread/{id}` 嵌套路由数据；`/video-sharing?share_id=...&video_id=...` 分享 API | 原图优先取 `image_ori_raw` / `image_raw`；有 Cookie 时尝试视频模型、FPLAY 原片和 `original_media_info`。公开预览仍可能带硬编码水印。 |
| 即梦 | 短链跳转后请求 `mweb/v1/get_item_info`，提交 `published_item_id` | 优先原视频，回退时按分辨率和码率选择；上游原始字段可能仍带水印，不保证每个作品都能取得无水印视频。 |
| 小云雀 | 短链跳转后的参数提交 `pippit/share/landing_page` | 支持图集与视频下载地址；短链携带追踪参数时仍先解析跳转。公开字段不明确水印状态时标记 `unknown`。 |
| 可灵 | `klingai-share.kuaishou.com/app/creatives/query` | 支持 `creative_id` / `work_id`；提取作品视频、封面和作者，水印状态以可用元数据为准。 |
| 海螺 | 合并 Next.js Flight 分块读取 `videoAsset`，再回退 JSON-LD | 优先 `downloadURLWithAIWatermark`，去品牌大标但仍有 AI 生成角标；普通播放或 JSON-LD 回退不会标成无水印。支持 `.com` / `.video` 分享域名。 |
| 通义千问 | `window.__INITIAL_PROPS__`，兼容多层 URL/JSON 编码 | 支持图集与对话视频，同一素材优先 `downloadUrl`，避免重复收集预览、头像和输入查询素材。 |

豆包 FPLAY 使用响应内的 `key_seed`，先计算 `SHA-512(seed)`，再计算 `SHA-512(firstHash || salt)`，取前 16 字节为 AES-128-CBC 密钥、后 16 字节为 IV；密文跳过 4 字节头后解密。原片请求优先使用 `force_fids=base64("original")` 与 `codec_type=5`，失败后尝试兼容格式与 `original_media_info`。兼容格式无法确认无水印时保留 `unknown`。

## 配置与发现

Platform 中的配置组名称为「AI 去水印」，说明限定为 AI 创作平台的分享链接解析；实际媒体是否带水印以响应中的 `watermark` 为准。

Service 配置 Schema 暴露 `aiMedia.enabledPlatforms`（默认六个平台全部启用）和 `aiMedia.<platform>Cookie`。Cookie 使用现有 secret 加密下发、加密持久化和脱敏回读机制；每次请求读取当前配置，热更新后立即生效。

豆包原视频通常需要配置 `aiMedia.doubaoCookie`，可使用 `sessionid_ss=...` 或完整 Cookie。无 Cookie 时公开图片与公开视频预览仍可解析；不会自动读取浏览器登录态。其余平台 Cookie 为可选字段。

部署新 Service 后，在 Platform 的 Service 管理页重新发现即可取得六个独立接口和配置组；随后按现有流程分别发布所需平台的 Route。各平台使用独立的首个业务 Tag，可分别展示、启用和配置调用策略。修改模块只需要发布 Service，不需要新增 Platform 专用页面。Service 的 OpenAPI 新增接口不会自动公开到公网。

## 请求边界与错误

网络请求复用 `safeFetch`，限定各平台 HTTPS 域名，每一跳重定向检查域名与 DNS 并固定连接地址。FPLAY 仅允许固定的豆包/字节播放域名，不把上游返回的 `fallback_api` 当作任意代理地址。Cookie 只发送至对应平台域名，跨源重定向时剥离，FPLAY 请求不携带平台 Cookie。

JSON 响应最多 4 MiB，HTML 最多 8 MiB，嵌套数据遍历有深度和节点上限。解析受 Service 整体请求截止时间约束；请求取消不会继续尝试下一视频或回退接口。结果不缓存，CDN 签名查询字符串原样保留，返回地址可能过期。

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `MISSING_PARAMETER` / `INVALID_PARAMETER` | 缺少 URL、参数超长、地址或作品 ID 无效 |
| 400 | `AI_MEDIA_PLATFORM_MISMATCH` | 分享链接与接口路径指定的平台不匹配；例如豆包接口提示「请提供豆包分享链接」 |
| 403 | `AI_MEDIA_PLATFORM_DISABLED` | 对应平台被管理员关闭，不会访问上游 |
| 422 | `UNSUPPORTED_PLATFORM` | 平台不在支持范围 |
| 422 | `PARSE_FAILED` | 分享不存在、失效或没有媒体 |
| 422 | `AI_MEDIA_AUTH_REQUIRED` | 平台拒绝访问，需要登录态或分享权限 |
| 502 | `UPSTREAM_ERROR` / `UPSTREAM_INVALID_RESPONSE` | 上游请求失败、JSON 无效或响应超限 |
| 503 | `UPSTREAM_BUSY` | 上游限流/繁忙；保留有效 `Retry-After`，停止回退请求 |
| 504 | `REQUEST_TIMEOUT` | 超过 Service 请求截止时间 |

错误正文不包含上游响应、Cookie 或内部异常；存在可用公开预览时，豆包登录接口失败可回退，并通过 `variant` 和 `watermark` 表达结果状态。
