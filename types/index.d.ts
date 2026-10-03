/** One usage figure the line draws. */
export type Meter = {
  /** Short label: 5h, 7d, spend, ctx. */
  label: string
  /** 0 to 100 (spend can pass 100). */
  percent: number
  /** ISO time the window resets, when it has one. */
  resetsAt?: string
}

/** How much of the line shows; /usage-line switches it. */
export type View = 'full' | 'compact' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'usage-line': {
      meters: Meter[]
      view: View
    }
  }
}
