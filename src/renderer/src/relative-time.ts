/** "il y a 3 h", or "3 h" when `short` (lists where the context says it's in the past). */
export function relativeTime(timestamp: number, short = false): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  const ago = (text: string) => (short ? text : `il y a ${text}`)
  if (minutes < 1) return short ? 'now' : 'à l’instant'
  if (minutes < 60) return ago(`${minutes} min`)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return ago(`${hours} h`)
  const days = Math.round(hours / 24)
  if (days < 30) return ago(`${days} j`)
  if (short) return days < 365 ? `${Math.round(days / 30)} mois` : `${Math.round(days / 365)} an${days >= 730 ? 's' : ''}`
  return new Date(timestamp).toLocaleDateString()
}
