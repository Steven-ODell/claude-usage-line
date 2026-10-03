import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T20:00:00Z')
const BAND = {
  plugin: 'usage-line',
  surface: 'terminal',
  component: 'SessionMode',
  props: { modes: [] as string[] },
} as const

function measure(five: number, seven: number, ctx: number) {
  return {
    context: { window: 200000, tokens: ctx * 2000, percent: ctx },
    rateLimits: [
      { kind: 'seven_day', percentUsed: seven, resetsAt: '2026-10-05T20:00:00Z' },
      { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-02T22:10:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  }
}

async function setup($: any, on: any, saved: Record<string, unknown> = {}) {
  mock.clock(on, { now: NOW })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  on('ui.render', () => h('Box', null))
  on('ui.toast', () => ({ value: undefined }))
  const store = new Map<string, unknown>(Object.entries(saved))
  on('command.register', () => ({ value: undefined }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/home/user', surface: 'terminal', isInteractive: true })
}

async function line($: any) {
  const ui = await $.ui.mount(BAND as any)
  const text = JSON.stringify(await ui.find({ type: 'Box' }))
  await ui.unmount()
  return text
}

test('nothing of its own before the first reading', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(BAND as any)
  expect(await ui.find({ type: 'Text', text: /5h|ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('draws 5h, 7d and ctx in that order with bars', async ($, on) => {
  await setup($, on)
  await $.session.measure(measure(42, 18, 31) as any)
  const text = await line($)
  expect(text.indexOf('5h')).toBeLessThan(text.indexOf('7d'))
  expect(text.indexOf('7d')).toBeLessThan(text.indexOf('ctx'))
  expect(text).toContain('▰▰')
  expect(text).toContain('│')
  expect(text).toContain('42%')
  expect(text).toContain('31%')
  expect(text).not.toContain('resets')
})

test('past 70% the window turns cyan and says when it resets; past 90% pink', async ($, on) => {
  await setup($, on)
  await $.session.measure(measure(93, 75, 10) as any)
  const text = await line($)
  expect(text).toContain('#ff5ea0')
  expect(text).toContain('#5ef1ff')
  expect(text).toContain('resets in 2h10m')
  expect(text).toContain('resets in 3d')
})

test('5h is five hour-cells with a mark at the current hour', async ($, on) => {
  await setup($, on)
  // window resets 22:10, so it began 17:10; NOW is 20:00, 2 whole hours in
  await $.session.measure(measure(42, 18, 31) as any)
  const text = await line($)
  expect(text).toContain('5h ▰▰│▱▱▱ 42%')
})

test('pace gap before 5h: green + under even pace, red - over', async ($, on) => {
  await setup($, on)
  // 2h50m into the window is 57% at even pace
  await $.session.measure(measure(42, 18, 31) as any)
  let text = await line($)
  expect(text).toContain('#5eff6c')
  expect(text).toMatch(/15.*\+.*5h/)
  await $.session.measure(measure(63, 18, 31) as any)
  text = await line($)
  expect(text).toContain('#ff6e5e')
  expect(text).toMatch(/6.*-.*5h/)
})

test('7d is seven day-cells with a mark at today and its own pace gap', async ($, on) => {
  await setup($, on)
  // window resets 10-05 20:00, so it began 09-28 20:00; NOW is 4 days in, 57% at even pace
  await $.session.measure(measure(42, 18, 31) as any)
  let text = await line($)
  expect(text).toContain('7d ▰▱▱▱│▱▱▱ 18%')
  expect(text).toMatch(/39.*\+.*7d/)
  await $.session.measure(measure(42, 70, 31) as any)
  text = await line($)
  expect(text).toMatch(/#ff6e5e[^7]*13.*-.*7d/)
})

test('/usage-line cycles full, compact, off and back, and takes a name', async ($, on) => {
  await setup($, on)
  await $.session.measure(measure(42, 18, 31) as any)
  expect((await $.command.run({ command: 'usage-line', args: '' } as any)).text).toContain('compact')
  let text = await line($)
  expect(text).toContain('42%')
  expect(text).not.toContain('▰')
  expect(text).toMatch(/15.*\+.*5h/)
  await $.command.run({ command: 'usage-line', args: '' } as any)
  const ui = await $.ui.mount(BAND as any)
  expect(await ui.find({ type: 'Text', text: /5h|ctx/ })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'usage-line', args: 'FULL' } as any)
  expect(await line($)).toContain('▰')
  expect((await $.command.run({ command: 'usage-line', args: 'tiny' } as any)).text).toContain('unknown view')
})

test('a view saved by an earlier session is used from the start', async ($, on) => {
  await setup($, on, { view: 'compact' })
  await $.session.measure(measure(42, 18, 31) as any)
  const text = await line($)
  expect(text).toContain('42%')
  expect(text).not.toContain('▰')
})
