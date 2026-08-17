import data from './data.json' with { type: 'json' }

interface LuckGroup { category: string, rank: number, content: string[] }
export interface LuckData {
  id: number
  category: string
  rank: number
  tip: string
  tip_index: number
}
const groups: readonly LuckGroup[] = data

export function parseLuckId(value: string): number | null | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) return null
  const id = Number(normalized)
  return Number.isSafeInteger(id) ? id : null
}

export function getLuck(
  id?: number,
  random: () => number = Math.random
): LuckData | null {
  const groupId = id ?? Math.floor(random() * groups.length)
  const group = groups[groupId]
  if (!group) return null
  const tipIndex = Math.floor(random() * group.content.length)
  const tip = group.content[tipIndex]
  return tip ? {
    id: groupId,
    category: group.category,
    rank: group.rank,
    tip,
    tip_index: tipIndex
  } : null
}

export function formatLuckText(value: LuckData): string {
  return `${value.category}：${value.tip}`
}
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!|<>])/g, '\\$1')
}
export function formatLuckMarkdown(value: LuckData): string {
  return `# 今日运势\n\n## ${escapeMarkdown(value.category)}\n\n> ${escapeMarkdown(value.tip)}\n\n**运势值：** ${value.rank}\n\n类别 ID：${value.id} · 提示 ID：${value.tip_index}`
}
