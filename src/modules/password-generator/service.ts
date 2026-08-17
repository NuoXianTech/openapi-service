import { randomInt } from 'node:crypto'

export type PasswordGeneratorMode = 'strong' | 'alphanumeric' | 'numeric'
type CharacterType = 'lowercase' | 'uppercase' | 'numbers' | 'symbols'
export interface PasswordGeneratorResult {
  password: string
  length: number
  mode: PasswordGeneratorMode
  character_types: CharacterType[]
  entropy: number
  strength: '弱' | '中等' | '强' | '极强'
  ambiguous_characters_excluded: true
}

const CHARACTER_SETS: Record<CharacterType, string> = {
  lowercase: 'abcdefghjkmnpqrstuvwxyz',
  uppercase: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  numbers: '23456789',
  symbols: '!@#$%^&*_-+=?'
}
const MODE_TYPES: Record<PasswordGeneratorMode, readonly CharacterType[]> = {
  strong: ['lowercase', 'uppercase', 'numbers', 'symbols'],
  alphanumeric: ['lowercase', 'uppercase', 'numbers'],
  numeric: ['numbers']
}

export function parsePasswordLength(value: string): number | null {
  if (!value) return 16
  if (!/^\d+$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 4 && length <= 128
    ? length
    : null
}

export function parsePasswordGeneratorMode(
  value: string
): PasswordGeneratorMode | null {
  if (!value) return 'strong'
  const mode = value.toLowerCase()
  return mode === 'strong' || mode === 'alphanumeric' || mode === 'numeric'
    ? mode
    : null
}

function randomCharacter(characters: string): string {
  return characters[randomInt(characters.length)]!
}

function secureShuffle(characters: string[]): void {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1)
    const value = characters[index]!
    characters[index] = characters[target]!
    characters[target] = value
  }
}

export function generatePassword(options: {
  length: number
  mode: PasswordGeneratorMode
}): PasswordGeneratorResult {
  if (!Number.isSafeInteger(options.length)
    || options.length < 4
    || options.length > 128) {
    throw new RangeError('length 必须是 4-128 之间的整数')
  }
  if (!Object.hasOwn(MODE_TYPES, options.mode)) {
    throw new TypeError('mode 不受支持')
  }
  const characterTypes = [...MODE_TYPES[options.mode]]
  const pool = characterTypes.map(type => CHARACTER_SETS[type]).join('')
  const characters = characterTypes.map(type => (
    randomCharacter(CHARACTER_SETS[type])
  ))
  while (characters.length < options.length) {
    characters.push(randomCharacter(pool))
  }
  secureShuffle(characters)
  const entropy = Math.round(
    options.length * Math.log2(pool.length) * 100
  ) / 100
  return {
    password: characters.join(''),
    length: options.length,
    mode: options.mode,
    character_types: characterTypes,
    entropy,
    strength: entropy < 40 ? '弱'
      : entropy < 64 ? '中等'
        : entropy < 96 ? '强' : '极强',
    ambiguous_characters_excluded: true
  }
}

export function formatPasswordGeneratorMarkdown(
  result: PasswordGeneratorResult
): string {
  return `# 随机密码\n\n\`\`\`text\n${result.password}\n\`\`\`\n\n- 长度：${result.length}\n- 模式：${result.mode}\n- 估算熵值：${result.entropy} bits\n- 强度：${result.strength}`
}
