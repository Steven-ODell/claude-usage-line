// usage-line: Claude usage at the right end of the prompt footer, on the line
// with the mode pills:   15+ 5h ▰▰│▱▱▱ 42% · 39+ 7d ▰▱▱▱│▱▱▱ 18% · ctx 31%
//
// 5h has one cell per hour and 7d one per day, with "│" at where the window
// is now. The number before each is the gap to an even pace through it: 15+
// in green is 15 points under where steady use would be, 6- in red is 6 over.
//
// 5h and 7d are the subscription's rate-limit windows, as the last response
// reported them (none until the first reply of a session). ctx is how full
// the context window is. Figures arrive with session.measure, so nothing polls.
// Crossing 90% on a window raises one toast per window per reset.
//
// /usage-line cycles full → compact → off; /usage-line full|compact|off sets
// one. The choice is kept across sessions. Compact drops the bars and resets:
//   15+ 5h 42% · 39+ 7d 18% · ctx 31%

import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter, View } from '../types'

const meters = atom({ plugin: 'usage-line', key: 'meters' } as const, [])
const view = atom({ plugin: 'usage-line', key: 'view' } as const, 'full')

const VIEWS: View[] = ['full', 'compact', 'off']

/** The view a /usage-line argument asks for: a name sets it, nothing cycles. */
export function nextView(current: View, args: string): View | null {
  const want = args.trim().toLowerCase()
  if (want === '') return VIEWS[(VIEWS.indexOf(current) + 1) % VIEWS.length] ?? 'full'
  return VIEWS.includes(want as View) ? (want as View) : null
}

// Cyberdream palette. No yellow or orange.
const PURPLE = '#b07cf5'
const CYAN = '#5ef1ff'
const PINK = '#ff5ea0'
// Pace gap only: green under even pace, red over.
const GREEN = '#5eff6c'
const RED = '#ff6e5e'

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const ORDER = ['5h', '7d', 'spend']
const CELLS = 6

export function colorFor(percent: number): string {
  if (percent >= 90) return PINK
  if (percent >= 70) return CYAN
  return PURPLE
}

export function bar(percent: number, cells: number = CELLS): string {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A window drawn with a time mark: its length and one cell per unit of it. */
export type Window = { length: number; cells: number }
export const WINDOWS: Record<string, Window> = {
  '5h': { length: 5 * HOUR, cells: 5 },
  '7d': { length: 7 * DAY, cells: 7 },
}

/** The bar cut at the time mark with "│" between: ["▰▰", "│", "▱▱▱"]. */
export function splitAt(cells: string, at: number | null): string[] {
  if (at === null) return [cells]
  const chars = [...cells]
  return [chars.slice(0, at).join(''), '│', chars.slice(at).join('')].filter(p => p !== '')
}

/** How far into the window now is, 0 to its length; null without a reset time. */
function elapsedIn(w: Window, resetsAt: string | undefined, now: number): number | null {
  if (!resetsAt) return null
  const end = Date.parse(resetsAt)
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.min(w.length, now - (end - w.length)))
}

/** How many whole cells (hours of 5h, days of 7d) of the window have passed. */
export function cellsIn(w: Window, resetsAt: string | undefined, now: number): number | null {
  const elapsed = elapsedIn(w, resetsAt, now)
  return elapsed === null ? null : Math.floor(elapsed / (w.length / w.cells))
}

/** Points between even pace and actual use of the window, rounded: positive
 *  is under pace, negative over. null when there is no reset time. */
export function paceGap(w: Window, percent: number, resetsAt: string | undefined, now: number): number | null {
  const elapsed = elapsedIn(w, resetsAt, now)
  return elapsed === null ? null : Math.round((elapsed / w.length) * 100 - percent)
}

/** Turn the engine's figures into the meters the line draws, in a fixed order. */
export function toMeters(limits: readonly SessionRateLimit[], context: SessionContextUsage): Meter[] {
  const out: Meter[] = limits
    .map(l => ({ label: LABELS[l.kind] ?? l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.label)
      const ib = ORDER.indexOf(b.label)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  if (typeof context.percent === 'number') out.push({ label: 'ctx', percent: context.percent })
  return out
}

/** Time until the reset, as "in 2h10m" or "in 3d". Relative, so the time zone
 *  the mod runs in never matters. */
export function resetText(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.max(0, Math.round((at - now) / 60000))
  if (mins < 60) return `in ${mins}m`
  if (mins < 48 * 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `in ${h}h${m}m` : `in ${h}h`
  }
  return `in ${Math.round(mins / 1440)}d`
}

export const register: Register = on => {
  // Windows already warned about, by label and reset time, so each warns once.
  const warned = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'usage-line',
      description: 'Usage line view: full, compact or off (no argument cycles)',
    })
    const saved = await $.store.get('view')
    if (VIEWS.includes(saved as View)) await update($, view, () => saved as View)
    const usage = await $.session.usage()
    const fresh = toMeters(usage.rateLimits, usage.context)
    await update($, meters, () => fresh)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const fresh = toMeters(e.rateLimits, e.context)
    await update($, meters, () => fresh)
    for (const m of fresh) {
      if (m.label === 'ctx' || m.percent < 90) continue
      const id = `${m.label}@${m.resetsAt ?? ''}`
      if (warned.has(id)) continue
      warned.add(id)
      const when = resetText(m.resetsAt, await $.clock.now())
      $.ui.toast(`Claude ${m.label} usage at ${Math.round(m.percent)}%${when ? `, resets ${when}` : ''}`)
    }
    return next(e)
  })

  on('command.run', { command: 'usage-line' }, async ($, e) => {
    const chosen = nextView(await read($, view), e.args)
    if (chosen === null) return { text: `Usage line: unknown view "${e.args.trim()}". Use full, compact or off.` }
    await update($, view, () => chosen)
    await $.store.set('view', chosen)
    return { text: `Usage line: ${chosen}.` }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, meters)
    const shown = await read($, view)
    if (list.length === 0 || shown === 'off') return next(e)
    const isCompact = shown === 'compact'
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} · </Text>}
        {list.map((m, i) => {
          const color = colorFor(m.percent)
          const reset = !isCompact && m.label !== 'ctx' && m.percent >= 70 ? resetText(m.resetsAt, now) : ''
          const w = WINDOWS[m.label]
          const gap = w ? paceGap(w, m.percent, m.resetsAt, now) : null
          return (
            <Box key={m.label}>
              {i > 0 && <Text dimColor> · </Text>}
              {gap !== null && (
                <Text color={gap >= 0 ? GREEN : RED}>
                  {Math.abs(gap)}
                  {gap >= 0 ? '+' : '-'}{' '}
                </Text>
              )}
              <Text dimColor>{m.label} </Text>
              {w &&
                !isCompact &&
                splitAt(bar(m.percent, w.cells), cellsIn(w, m.resetsAt, now)).map((part, j) =>
                  part === '│' ? (
                    <Text key={`t${j}`} bold>{part}</Text>
                  ) : (
                    <Text key={`c${j}`} color={color}>{part}</Text>
                  ),
                )}
              {w && !isCompact && <Text> </Text>}
              {!w && !isCompact && m.label !== 'ctx' && <Text color={color}>{bar(m.percent)} </Text>}
              <Text color={color}>{Math.round(m.percent)}%</Text>
              {reset !== '' && <Text dimColor> resets {reset}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
