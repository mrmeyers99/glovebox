// Display formatting for distances, durations, money, dates and times.
// Fixed to en-US: the app is USD and miles only for now.

const LOCALE = 'en-US'

const milesFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

const moneyFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'USD',
})

/** Miles to 0 decimals, e.g. `1,234 mi`. */
export function formatMiles(miles: number) {
  return `${milesFormat.format(miles)} mi`
}

/** Seconds as hours and minutes, e.g. `5h 20m`, `45m`, `2h 05m`. */
export function formatDuration(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m`
}

/** US dollars, e.g. `$1,234.50`. */
export function formatMoney(amount: number) {
  return moneyFormat.format(amount)
}

/** A YYYY-MM-DD date, e.g. `Sat, Jul 4`, without shifting time zones. */
export function formatDayDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALE, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** A Postgres `time` (HH:MM or HH:MM:SS), e.g. `2:30 PM`. */
export function formatTimeOfDay(time: string) {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}
