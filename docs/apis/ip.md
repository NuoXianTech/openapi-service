# IP 归属地公共接口

`GET /v1/ip` 使用服务器本地的纯真 CZDB 数据库查询 IPv4 或 IPv6 归属地，不请求第三方在线接口，也不依赖 `czdb` npm 包。

## 请求参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `ip` | 否 | IPv4 或 IPv6；省略时使用平台按直连、Cloudflare 或 `X-Forwarded-For` 配置解析出的客户端 IP |

```bash
# 查询当前调用方 IP
curl 'http://127.0.0.1:3000/v1/ip'

# IPv4
curl 'http://127.0.0.1:3000/v1/ip?ip=8.8.8.8'

# IPv6
curl 'http://127.0.0.1:3000/v1/ip?ip=240e%3A391%3Aed3%3A8a10%3A%3A1'
```

`0.0.0.0`、`::` 和 IPv4-mapped IPv6 都会按合法 IP 解析；数据库没有对应记录时返回 `404 IP_NOT_FOUND`。

## 成功响应

```json
{
  "code": "OK",
  "message": "IP 归属地查询成功",
  "data": {
    "ip": "8.8.8.8",
    "ip_version": "ipv4",
    "country_name": "美国",
    "region_name": "加利福尼亚州",
    "city_name": "圣克拉拉",
    "district_name": "山景城",
    "internet_service_provider": "谷歌公司DNS服务器",
    "database_version": 20260325
  },
  "timestamp": 1785590000000
}
```

数据库缺少的层级返回 `null`，不会用空字符串或字符串 `"null"` 占位。响应设置 `Cache-Control: no-store`，避免省略 `ip` 时缓存其他调用方的地址结果。

## 数据库与密钥配置

从 [纯真社区版 IP 库](https://cz88.net/geo-public) 下载以下文件及其配套密钥：

- `cz88_public_v4.czdb`
- `cz88_public_v6.czdb`

数据库文件不属于项目源码或构建产物，不得提交到 Git。所有外挂文件统一位于 `SERVICE_DATA_DIR/assets/<module-id>`；本接口固定读取：

```text
data/assets/ip/cz88_public_v4.czdb
data/assets/ip/cz88_public_v6.czdb
```

Git 忽略整个本地 `data/`，避免误提交任何授权数据或运行快照。官方镜像中的对应路径为 `/app/data/assets/ip`，Service Compose 会把宿主机 `./data/assets` 整体只读挂载到容器：

```bash
-v /var/lib/openapi-service/assets:/app/data/assets:ro
```

不再提供 `IP_DATABASE_DIRECTORY`。如需改变宿主机位置，只改变 Volume 左侧路径；容器内模块目录保持固定。在 Platform 的 Internal Upstream 管理页配置 Secret 字段 `ip.databaseKey`。保存后密钥会热更新，无需重启 Service。Service 不从环境变量读取该密钥，Platform 是唯一期望状态源。

替换 CZDB 文件或修改挂载目录后滚动重启 `openapi-service`，不需要停止 Platform。数据库过期、密钥错误、文件缺失或损坏时返回 `503 IP_DATABASE_UNAVAILABLE`；密钥尚未配置时返回 `503 IP_DATABASE_NOT_CONFIGURED`。

## 实现说明

- 只实现查询所需的 CZDB BTREE 读取和最小 MessagePack 解码，全部使用 Node.js 内置模块。
- 每次查询仅异步读取对应索引窗口和数据块，不把约 40MB 的 IPv4/IPv6 数据库整体载入内存。
- 文件路径固定在 Service 外挂数据目录；密钥只允许由受信 Platform 控制协议提供，调用方和公开 Route 都不能指定数据库文件或密钥。
- CZDB 文件及其数据授权以下载页面提供的条款为准；项目只包含兼容读取实现。
