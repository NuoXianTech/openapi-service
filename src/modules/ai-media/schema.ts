import { z } from '@hono/zod-openapi'
import { createSuccessEnvelopeSchema } from '../../shared/openapi.js'

const MediaUrlSchema = z.url({ protocol: /^https?$/ }).openapi({
  description: 'HTTP(S) 资源地址；保留 CDN 签名参数，地址可能过期。'
})
const NullableTextSchema = z.string().min(1).nullable()

const MediaItemSchema = z.object({
  type: z.enum(['image', 'video']).openapi({ description: '媒体类型。' }),
  url: MediaUrlSchema,
  variant: z.enum(['original', 'download', 'preview']).openapi({
    description: '媒体版本：original 为原始版本，download 为下载或作品资源，preview 为预览回退；不表示水印状态。'
  }),
  watermark: z.enum(['none', 'ai-generated', 'present', 'unknown']).openapi({
    description: '上游字段或 URL 表明的水印状态：none 无水印，ai-generated 保留 AI 生成角标，present 已知带水印，unknown 无法判断；未执行像素检测。'
  })
}).strict().openapi('AiMediaItem')

export const AiMediaDataSchema = z.object({
  author: NullableTextSchema.openapi({ description: '作者名称；未知时为 null。' }),
  uid: NullableTextSchema.openapi({ description: '作者标识，包含上游整数 ID，统一使用字符串以保留大整数精度和前导零；未知时为 null。' }),
  avatar: MediaUrlSchema.nullable().openapi({ description: '作者头像地址；未知时为 null。' }),
  title: NullableTextSchema.openapi({ description: '作品标题或描述；上游未提供时为 null。' }),
  cover: MediaUrlSchema.nullable().openapi({
    description: '作品封面；缺失时使用第一张结果图片，没有可用图片时为 null。'
  }),
  media: z.array(MediaItemSchema).min(1).openapi({
    description: '去重后的媒体列表，保留解析顺序；成功响应至少包含一项。'
  })
}).strict().openapi('AiMediaData')

export const AiMediaResponseSchema = createSuccessEnvelopeSchema(AiMediaDataSchema)
  .extend({ data: AiMediaDataSchema })
  .openapi('AiMediaResponse')
