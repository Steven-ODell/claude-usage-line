# Build your own usage line

Paste everything below the line into Claude Code. Change anything you like
first: colors, cell counts, what compact mode drops.

---

Write me a Claude Code plugin made of function hooks (load the
plugin-authoring skill first) that draws my Claude usage on the prompt
footer line with the mode pills, by hooking `ui.render` for the
`SessionMode` component. Keep any mode pills that are on and draw after
them with a ` · ` between.

**Data.** Read the rate limits and context usage on `session.start` from
`$.session.usage()`, and again on every `session.measure`. Keep them in
`$.state`, so nothing polls. Draw nothing of my own until there are figures.
Order: 5-hour window, 7-day window, then context.

**Each window (5h and 7d)** draws as:

```
<gap> <label> <bar> <percent>
15+ 5h ▰▰│▱▱▱ 42%
```

- The bar has one cell per hour for 5h (5 cells) and one per day for 7d
  (7 cells). Filled cells `▰` are usage rounded to the nearest cell, and
  empty cells are `▱`.
- Put a bold `│` after the whole hours or days that have passed. The window
  started at its reset time minus its length.
- The gap is the even pace minus usage, in percentage points, rounded. Even
  pace is the fraction of the window elapsed (not rounded to whole cells)
  times 100. Show a positive or zero gap as `N+` in green and a negative one
  as `N-` in red.
- Color the bar and the percent purple, cyan from 70%, and pink from 90%.
  From 70% on, add a dim `resets in 2h10m`, or `in 3d` for longer waits.

**Context** draws as `ctx 31%`, with no bar or gap.

**Labels and separators** are dim.

**Toast** once per window per reset when a window crosses 90%: "Claude 5h
usage at 93%, resets in 2h10m".

**A `/usage-line` command** cycles full → compact → off, or takes `full`,
`compact` or `off` as an argument. Compact drops the bars and the reset
text: `15+ 5h 42% · 39+ 7d 18% · ctx 31%`. Off draws only the engine's own
footer. Save the choice in `$.store` so new sessions start with it.

Write tests for the pace gap, the time mark, the colors and the command, and
run `claude plugin validate` and `claude plugin test` before you call it
done.
