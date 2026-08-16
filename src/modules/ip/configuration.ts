import type { ConfigurationGroup } from '../../configuration/types.js'

export const ipConfigurationGroup = {
  key: 'ip',
  label: 'IP 归属地',
  description: '控制 CZDB 查询能力及其数据库授权密钥。数据库文件目录仍由部署环境管理。',
  fields: [
    {
      key: 'ip.enabled',
      type: 'boolean',
      label: '启用 IP 查询',
      description: '关闭后 /v1/ip 返回能力已停用。',
      default: true
    },
    {
      key: 'ip.databaseKey',
      type: 'secret',
      label: 'CZDB 数据库密钥',
      description: '密钥只接受 Platform 下发，不会通过读取接口或日志回显。',
      placeholder: '请输入 CZDB Base64 密钥',
      maxLength: 4096
    }
  ]
} as const satisfies ConfigurationGroup
