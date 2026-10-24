import { language } from '../lib/i18n'

const locale = language === 'id' ? 'id-ID' : 'en-GB'

/** This month as a grid of weeks, today marked (the Calendar widget, the clock's panel). */
export function MonthCalendar({ date, weekStart = 'monday', className = '' }: { date: Date; weekStart?: 'monday' | 'sunday'; className?: string }) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const startsMonday = weekStart === 'monday'
  const lead = (first.getDay() + (startsMonday ? 6 : 0)) % 7
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  // Short weekday names, starting on the chosen day (1 Jan 2024 was a Monday).
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, startsMonday ? 1 + i : 7 + i).toLocaleDateString(locale, { weekday: 'narrow' }))
  return (
    <div className={`w-cal-grid ${className}`}>
      {names.map((n, i) => (
        <span key={`h${i}`} className="w-cal-head">
          {n}
        </span>
      ))}
      {cells.map((d, i) => (
        <span key={i} className={d === date.getDate() ? 'is-today' : ''}>
          {d ?? ''}
        </span>
      ))}
    </div>
  )
}
