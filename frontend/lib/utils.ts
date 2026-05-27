export function scoreColor(score: number) {
  if (score >= 80) return 'bg-black text-white'
  if (score >= 60) return 'bg-gray-700 text-white'
  return 'bg-gray-200 text-gray-700'
}

export function timelineColor(timeline: string) {
  if (timeline === 'Urgent') return 'text-red-500'
  if (timeline === 'Active') return 'text-amber-500'
  return 'text-gray-400'
}

export function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function isOlderThan24h(iso: string | null): boolean {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) > 24 * 60 * 60 * 1000
}

export function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const weeks = Math.floor(days / 7)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  if (weeks < 5) return `${weeks}w`
  return formatDate(iso)
}
