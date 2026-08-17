const PASSWORD_MAX_CODE_POINTS = 128

export interface PasswordCheckResult {
  length: number
  score: number
  strength: '极弱' | '弱' | '中等' | '强' | '极强'
  entropy: number
  time_to_crack: string
  character_analysis: {
    has_lowercase: boolean
    has_uppercase: boolean
    has_numbers: boolean
    has_symbols: boolean
    has_other_letters: boolean
    has_repeated: boolean
    has_sequential: boolean
    is_common_password: boolean
    character_variety: number
    unique_characters: number
  }
  recommendations: string[]
  security_tips: string[]
}

interface PasswordSignals {
  codePoints: string[]
  hasLowercase: boolean
  hasUppercase: boolean
  hasNumbers: boolean
  hasSymbols: boolean
  hasOtherLetters: boolean
  hasRepeated: boolean
  hasSequential: boolean
  isCommonPassword: boolean
  characterVariety: number
  uniqueCharacters: number
  categoryCount: number
  uniqueRatio: number
}

const COMMON_PASSWORDS = new Set([
  '1234', '12345', '123456', '1234567', '12345678', '123456789',
  '1234567890', '111111', '000000', '666666', '888888', '654321',
  '123123', '123321', 'abc123', 'abcdef', 'abcdefgh', 'admin',
  'admin123', 'iloveyou', 'letmein', 'login', 'master', 'monkey',
  'passw0rd', 'password', 'password1', 'password123', 'qazwsx',
  'qwerty', 'qwerty123', 'qwertyuiop', 'root', 'superman', 'welcome',
  'welcome123', 'woaini', '密码', '我爱你'
])
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl',
  'zxcvbnm', '1qaz', '2wsx', '3edc', '4rfv', '5tgb', '6yhn', '7ujm'
]
const SECURITY_TIPS = [
  '不同站点使用不同的密码',
  '使用可信的密码管理器生成和保存长密码',
  '重要账户应同时启用多因素认证',
  '强度评分只是估算，不能代替密码泄露检查'
]
const LOWERCASE_RE = /\p{Ll}/u
const UPPERCASE_RE = /\p{Lu}/u
const NUMBER_RE = /\p{N}/u
const LETTER_RE = /\p{L}/u

export type PasswordCheckBodyResult =
  | { ok: true, password: string }
  | { ok: false, code: string, message: string }

export function countPasswordCodePoints(password: string): number {
  return Array.from(password).length
}

export function parsePasswordCheckBody(body: unknown): PasswordCheckBodyResult {
  if (
    typeof body !== 'object'
    || body === null
    || Array.isArray(body)
    || typeof (body as Record<string, unknown>).password !== 'string'
  ) {
    return {
      ok: false,
      code: 'INVALID_REQUEST_BODY',
      message: '请求体必须包含字符串字段 password'
    }
  }
  const password = (body as { password: string }).password
  const length = countPasswordCodePoints(password)
  if (length === 0) {
    return { ok: false, code: 'PASSWORD_REQUIRED', message: 'password 不能为空' }
  }
  if (length > PASSWORD_MAX_CODE_POINTS) {
    return {
      ok: false,
      code: 'PASSWORD_TOO_LONG',
      message: `password 不能超过 ${PASSWORD_MAX_CODE_POINTS} 个 Unicode 码点`
    }
  }
  return { ok: true, password }
}

function hasSequence(password: string): boolean {
  const value = password.toLowerCase()
  return SEQUENCES.some(source => Array.from(
    { length: source.length - 2 },
    (_, index) => source.slice(index, index + 3)
  ).some(sequence => (
    value.includes(sequence)
    || value.includes(Array.from(sequence).reverse().join(''))
  )))
}

function analyze(password: string): PasswordSignals {
  const codePoints = Array.from(password)
  const hasLowercase = codePoints.some(value => LOWERCASE_RE.test(value))
  const hasUppercase = codePoints.some(value => UPPERCASE_RE.test(value))
  const hasNumbers = codePoints.some(value => NUMBER_RE.test(value))
  const hasOtherLetters = codePoints.some(value => (
    LETTER_RE.test(value)
    && !LOWERCASE_RE.test(value)
    && !UPPERCASE_RE.test(value)
  ))
  const hasSymbols = codePoints.some(value => (
    !LETTER_RE.test(value) && !NUMBER_RE.test(value)
  ))
  const hasRepeated = codePoints.some((value, index) => (
    index >= 2 && value === codePoints[index - 1] && value === codePoints[index - 2]
  ))
  const uniqueCharacters = new Set(codePoints).size
  const categories = [
    hasLowercase, hasUppercase, hasNumbers, hasSymbols, hasOtherLetters
  ]
  return {
    codePoints,
    hasLowercase,
    hasUppercase,
    hasNumbers,
    hasSymbols,
    hasOtherLetters,
    hasRepeated,
    hasSequential: hasSequence(password),
    isCommonPassword: COMMON_PASSWORDS.has(password.toLowerCase()),
    characterVariety:
      (hasLowercase ? 26 : 0)
      + (hasUppercase ? 26 : 0)
      + (hasNumbers ? 10 : 0)
      + (hasSymbols ? 33 : 0)
      + (hasOtherLetters ? 100 : 0),
    uniqueCharacters,
    categoryCount: categories.filter(Boolean).length,
    uniqueRatio: uniqueCharacters / codePoints.length
  }
}

function score(signals: PasswordSignals): number {
  let value = Math.min(signals.codePoints.length, 20) * 3
  value += Math.max(0, Math.min(signals.categoryCount, 4) - 1) * 8
  if (signals.codePoints.length >= 12) value += 6
  if (signals.codePoints.length >= 16) value += 6
  if (signals.uniqueRatio >= 0.7) value += 4
  if (signals.categoryCount === 1) value -= 8
  if (signals.hasRepeated) value -= 15
  if (signals.hasSequential) value -= 15
  if (signals.isCommonPassword) value -= 40
  if (signals.uniqueRatio < 0.35) value -= 10
  return Math.max(0, Math.min(100, Math.round(value)))
}

function entropy(signals: PasswordSignals): number {
  let value = signals.codePoints.length
    * Math.log2(Math.max(signals.characterVariety, 1))
  if (signals.hasRepeated) value *= 0.72
  if (signals.hasSequential) value *= 0.72
  if (signals.uniqueRatio < 0.5) value *= 0.75
  if (signals.isCommonPassword) value = Math.min(value, 10)
  return Math.round(Math.max(0, value) * 100) / 100
}

function formatAmount(value: number): string {
  if (value < 10) return value.toFixed(1).replace(/\.0$/, '')
  return Math.round(value).toLocaleString('zh-CN')
}

function crackTime(bits: number): string {
  const seconds = 2 ** Math.max(bits - 1, 0) / 10_000_000_000
  if (seconds < 1) return '估算少于 1 秒'
  if (seconds < 60) return `估算约 ${formatAmount(seconds)} 秒`
  if (seconds < 3_600) return `估算约 ${formatAmount(seconds / 60)} 分钟`
  if (seconds < 86_400) return `估算约 ${formatAmount(seconds / 3_600)} 小时`
  if (seconds < 31_536_000) return `估算约 ${formatAmount(seconds / 86_400)} 天`
  const years = seconds / 31_536_000
  return years >= 1_000_000
    ? '估算超过 100 万年'
    : `估算约 ${formatAmount(years)} 年`
}

function recommendations(signals: PasswordSignals, value: number): string[] {
  const result: string[] = []
  if (signals.isCommonPassword) result.push('不要使用已知的常见密码')
  if (signals.codePoints.length < 12) result.push('建议将密码长度增加到至少 12 个字符')
  else if (signals.codePoints.length < 16) result.push('重要账户建议使用至少 16 个字符')
  if (signals.categoryCount < 3) result.push('混合使用字母、数字或符号中的多种类型')
  if (signals.hasRepeated) result.push('避免连续使用三个或更多相同字符')
  if (signals.hasSequential) result.push('避免使用 abc、123 或 qwerty 类连续序列')
  if (signals.uniqueRatio < 0.5) result.push('增加不同字符的数量，减少重复模式')
  if (result.length === 0 && value >= 70) {
    result.push('当前强度较好，仍请确保未在其他站点重复使用')
  }
  return result
}

export function checkPasswordStrength(password: string): PasswordCheckResult {
  const parsed = parsePasswordCheckBody({ password })
  if (!parsed.ok) throw new RangeError(parsed.message)
  const signals = analyze(password)
  const scoreValue = score(signals)
  const entropyValue = entropy(signals)
  return {
    length: signals.codePoints.length,
    score: scoreValue,
    strength: scoreValue < 30 ? '极弱'
      : scoreValue < 50 ? '弱'
        : scoreValue < 70 ? '中等'
          : scoreValue < 85 ? '强' : '极强',
    entropy: entropyValue,
    time_to_crack: crackTime(entropyValue),
    character_analysis: {
      has_lowercase: signals.hasLowercase,
      has_uppercase: signals.hasUppercase,
      has_numbers: signals.hasNumbers,
      has_symbols: signals.hasSymbols,
      has_other_letters: signals.hasOtherLetters,
      has_repeated: signals.hasRepeated,
      has_sequential: signals.hasSequential,
      is_common_password: signals.isCommonPassword,
      character_variety: signals.characterVariety,
      unique_characters: signals.uniqueCharacters
    },
    recommendations: recommendations(signals, scoreValue),
    security_tips: [...SECURITY_TIPS]
  }
}

function yesNo(value: boolean): string {
  return value ? '是' : '否'
}

export function formatPasswordCheckText(result: PasswordCheckResult): string {
  return `密码强度检测\n\n评分：${result.score}/100\n强度：${result.strength}\n长度：${result.length} 个 Unicode 码点\n估算熵值：${result.entropy} bits\n破解时间：${result.time_to_crack}\n\n字符分析：\n- 小写字母：${yesNo(result.character_analysis.has_lowercase)}\n- 大写字母：${yesNo(result.character_analysis.has_uppercase)}\n- 数字：${yesNo(result.character_analysis.has_numbers)}\n- 符号：${yesNo(result.character_analysis.has_symbols)}\n- 其他文字：${yesNo(result.character_analysis.has_other_letters)}\n- 连续重复：${yesNo(result.character_analysis.has_repeated)}\n- 连续序列：${yesNo(result.character_analysis.has_sequential)}\n- 常见密码：${yesNo(result.character_analysis.is_common_password)}\n\n改进建议：\n${result.recommendations.map(item => `- ${item}`).join('\n')}\n\n安全提示：\n${result.security_tips.map(item => `- ${item}`).join('\n')}`
}

export function formatPasswordCheckMarkdown(result: PasswordCheckResult): string {
  return `# 密码强度检测\n\n| 指标 | 结果 |\n| --- | --- |\n| 评分 | ${result.score}/100 |\n| 强度 | ${result.strength} |\n| 长度 | ${result.length} 个 Unicode 码点 |\n| 估算熵值 | ${result.entropy} bits |\n| 破解时间 | ${result.time_to_crack} |\n\n## 字符分析\n\n| 类型 | 状态 |\n| --- | --- |\n| 小写字母 | ${yesNo(result.character_analysis.has_lowercase)} |\n| 大写字母 | ${yesNo(result.character_analysis.has_uppercase)} |\n| 数字 | ${yesNo(result.character_analysis.has_numbers)} |\n| 符号 | ${yesNo(result.character_analysis.has_symbols)} |\n| 其他文字 | ${yesNo(result.character_analysis.has_other_letters)} |\n| 连续重复 | ${yesNo(result.character_analysis.has_repeated)} |\n| 连续序列 | ${yesNo(result.character_analysis.has_sequential)} |\n| 常见密码 | ${yesNo(result.character_analysis.is_common_password)} |\n\n## 改进建议\n\n${result.recommendations.map(item => `- ${item}`).join('\n')}\n\n## 安全提示\n\n${result.security_tips.map(item => `- ${item}`).join('\n')}`
}
