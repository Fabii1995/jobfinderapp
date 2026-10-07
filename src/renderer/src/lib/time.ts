const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const DAY = 86_400_000

export function formatRelative(ts: number, now: number): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'just now'
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  return rtf.format(Math.round(diff / DAY), 'day')
}

export function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "Today" or "3d ago" from a posted timestamp. */
export function daysSincePosted(ts: number, now: number): string {
  const days = Math.floor((now - ts) / DAY)
  return days <= 0 ? 'Today' : `${days}d ago`
}
