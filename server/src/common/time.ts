/** CST 时间工具（Asia/Shanghai，迭代7 §4.3） */

export function cstDateStr(d = new Date()): string {
  // en-CA = YYYY-MM-DD，指定时区 Asia/Shanghai
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function cstMonthStr(d = new Date()): string {
  // YYYYMM
  const s = cstDateStr(d) // YYYY-MM-DD
  return s.slice(0, 4) + s.slice(5, 7)
}

export function cstDateToDayKey(dateStr: string): string {
  // YYYY-MM-DD -> YYYYMMDD
  return dateStr.replace(/-/g, '')
}
