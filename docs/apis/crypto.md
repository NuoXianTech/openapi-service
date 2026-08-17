# 加密与解密接口

Crypto 使用同一路径完成算法发现和文本处理：

- `GET /v1/crypto` 返回当前启用的算法与最小调用示例。
- `POST /v1/crypto` 执行编码、解码、加密或解密。

## 执行算法

```json
{
  "algorithm": "base64",
  "action": "encode",
  "input": "Hello"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `algorithm` | 是 | 算法编码，通过 `GET /v1/crypto` 获取 |
| `action` | 是 | `encode` 编码或加密；`decode` 解码或解密 |
| `input` | 是 | 待处理字符串 |
| `key` | 否 | 统一密钥字段；`emoji-aes` 与 `rc4` 必填 |
| `options` | 否 | 算法专属选项 |

成功响应使用 Service 标准响应壳：

```json
{
  "code": "OK",
  "message": "处理成功",
  "data": {
    "result": "SGVsbG8="
  },
  "timestamp": 1786924800000
}
```

算法专属参数必须放在 `options`。密钥始终使用根级 `key`，放入 `options.key` 会被拒绝。

```json
{
  "algorithm": "caesar",
  "action": "encode",
  "input": "Hello",
  "options": {
    "shift": 3
  }
}
```

## 内置算法

当前提供 `base64`、`beast`、`buddha`、`caesar`、`core-values`、`emoji-aes`、`morse`、`rc4` 和 `taiji`。

管理员可在 Platform 的 Service 配置中修改 `crypto.allowedAlgorithms`。未启用的算法不会出现在 GET 清单中，直接调用返回 `403 CRYPTO_ALGORITHM_DISABLED`。配置由 Platform 加密下发并热更新，不需要环境变量或重启 Service。

## 错误

- 请求体或参数结构错误：`400`
- 算法已被管理员关闭：`403`
- 算法不存在：`404`
- 输入、密钥或算法选项无效：`422`

所有错误也使用标准 JSON 响应壳，并在 `code` 中提供稳定的错误编码。
