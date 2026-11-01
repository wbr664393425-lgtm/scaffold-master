/* ============================================================
   日期取值：DateInput / DateRangePicker 共用的解析与规范化工具。
   全站只认两种规范字符串（与迁移页 value-format 对齐）：
     YYYY-MM-DD            date / dateMonth / year / daterange
     YYYY-MM-DD HH:mm:ss   datetime / datetimerange
   不用 Date 对象承载取值，避免时区与序列化歧义。
   ============================================================ */

export type DateKind = 'date' | 'datetime' | 'dateMonth' | 'year'
export type RangeKind = 'daterange' | 'datetimerange'

export interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface GridDay {
  /** 规范日期串，作为格子 key */
  key: string
  parts: DateParts
  /** 是否属于当前面板月份（上月末 / 下月初的补位格为 false） */
  inCurrentMonth: boolean
}

/** 表头：周日为首 */
export const WEEK_HEAD = ['日', '一', '二', '三', '四', '五', '六'] as const

export const MONTH_LABELS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

const pad = (n: number) => String(n).padStart(2, '0')

const clampNumber = (raw: string | undefined, fallback: number, min: number, max: number) => {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function todayParts(base = new Date()): DateParts {
  return {
    year: base.getFullYear(),
    month: base.getMonth() + 1,
    day: base.getDate(),
    hour: base.getHours(),
    minute: base.getMinutes(),
    second: base.getSeconds(),
  }
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

/** 宽松解析：接受 2026-3-5 / 2026/03/05 8:30 / 2026年3月5日 / 2026-03 / 2026 */
export function parseDate(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/[年月]/g, '-').replace(/日/g, '').replace(/\s+/g, ' ')
  if (!text) return null
  const matched = /^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(text)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2] ?? 1)
  const day = Number(matched[3] ?? 1)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return {
    year,
    month,
    day,
    hour: clampNumber(matched[4], 0, 0, 23),
    minute: clampNumber(matched[5], 0, 0, 59),
    second: clampNumber(matched[6], 0, 0, 59),
  }
}

/** 规范串：dateMonth 落到当月 1 日，year 落到当年 1 月 1 日 */
export function toCanonical(parts: DateParts, kind: DateKind | RangeKind) {
  const y = parts.year
  const m = pad(parts.month)
  const d = pad(parts.day)
  const date = kind === 'year' ? `${y}-01-01` : kind === 'dateMonth' ? `${y}-${m}-01` : `${y}-${m}-${d}`
  return kind === 'datetime' || kind === 'datetimerange' ? `${date} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` : date
}

/** 任意输入 → 规范串（不合法返回 null） */
export function normalize(value: unknown, kind: DateKind | RangeKind): string | null {
  const parts = parseDate(value)
  return parts ? toCanonical(parts, kind) : null
}

export function timeText(parts: DateParts) {
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

/** 只比日期部分：min / max 约束按天生效 */
export const dayValue = (parts: DateParts) => parts.year * 10000 + parts.month * 100 + parts.day
export const dayValueOf = (value: unknown) => {
  const parts = parseDate(value)
  return parts ? dayValue(parts) : null
}

export function withinLimit(parts: DateParts, min?: string | null, max?: string | null) {
  const value = dayValue(parts)
  const low = dayValueOf(min)
  const high = dayValueOf(max)
  return (low === null || value >= low) && (high === null || value <= high)
}

export function sameDay(a: DateParts | null, b: DateParts | null) {
  return Boolean(a && b && dayValue(a) === dayValue(b))
}

/** 按月 / 年粒度比较两个日期（选中态与「今天」高亮都按当前控件类型判定） */
export function isSameDayKey(a: DateParts | null, b: DateParts | null, kind: DateKind | RangeKind) {
  if (!a || !b) return false
  if (kind === 'year') return a.year === b.year
  if (kind === 'dateMonth') return a.year === b.year && a.month === b.month
  return dayValue(a) === dayValue(b)
}

export function monthLabel(month: number) {
  return MONTH_LABELS[month - 1] ?? ''
}

export function compareDay(a: DateParts, b: DateParts) {
  return dayValue(a) - dayValue(b)
}

export function addMonths(parts: DateParts, delta: number): DateParts {
  const zero = parts.year * 12 + (parts.month - 1) + delta
  const year = Math.floor(zero / 12)
  const month = zero - year * 12 + 1
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) }
}

export function shiftDay(parts: DateParts, delta: number): DateParts {
  const date = new Date(parts.year, parts.month - 1, parts.day + delta)
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** 6×7 网格：从当月 1 日所在周的周日开始，前补上月、后补下月 */
export function monthGrid(year: number, month: number): GridDay[] {
  const first = new Date(year, month - 1, 1)
  const cells: GridDay[] = []
  let cursor: DateParts = { ...todayParts(first), hour: 0, minute: 0, second: 0 }
  cursor = shiftDay(cursor, -first.getDay())
  for (let i = 0; i < 42; i += 1) {
    cells.push({
      key: `${cursor.year}-${pad(cursor.month)}-${pad(cursor.day)}`,
      parts: cursor,
      inCurrentMonth: cursor.month === month && cursor.year === year,
    })
    cursor = shiftDay(cursor, 1)
  }
  return cells
}

/** 十年格子（year 面板） */
export function yearGrid(anchorYear: number): DateParts[] {
  const start = Math.floor(anchorYear / 10) * 10
  return Array.from({ length: 12 }, (_, i) => ({ ...blankParts(), year: start - 1 + i }))
}

export const blankParts = (): DateParts => ({ year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 })

/** 区间排序：起点不晚于终点 */
export function orderRange(a: string | null, b: string | null): [string, string] | null {
  if (!a || !b) return null
  return dayValueOf(a)! <= dayValueOf(b)! ? [a, b] : [b, a]
}

/** 常用区间预设（迁移页顶栏快捷筛选） */
export function presetRange(kind: RangeKind, days: number): [string, string] {
  const end = todayParts()
  const start = shiftDay(end, -(days - 1))
  const low = { ...start, hour: 0, minute: 0, second: 0 }
  const high = { ...end, hour: 23, minute: 59, second: 59 }
  return [toCanonical(low, kind), toCanonical(high, kind)]
}
