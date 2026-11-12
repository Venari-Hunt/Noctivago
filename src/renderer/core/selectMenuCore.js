// Rules for the styled select menu (selectMenu.js), kept free of the DOM so
// node:test can check them. An "item" is { disabled?: boolean, label: string }.

// Next enabled index from `from` in `step` direction (+1/-1), clamped at the
// ends (a menu does not wrap, so holding the key stops at the last item).
// -1 when nothing is enabled.
export function stepIndex(items, from, step) {
  let i = from
  for (;;) {
    const next = i + step
    if (next < 0 || next >= items.length) break
    i = next
    if (!items[i].disabled) return i
  }
  return items[from] && !items[from].disabled ? from : firstEnabled(items)
}

export function firstEnabled(items) {
  return items.findIndex((it) => !it.disabled)
}

export function lastEnabled(items) {
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i
  return -1
}

// Type-ahead: `buffer` is what has been typed in the last second. A single
// repeated letter cycles through the items starting with it; a longer string
// finds the first item starting with all of it. Starts after `from`, wraps.
export function typeAhead(items, from, buffer) {
  if (!buffer) return -1
  const text = buffer.toLowerCase()
  const cycling = text.split('').every((c) => c === text[0])
  const needle = cycling ? text[0] : text
  const start = cycling ? from + 1 : Math.max(from, 0)
  for (let n = 0; n < items.length; n++) {
    const i = (start + n) % items.length
    if (!items[i].disabled && items[i].label.toLowerCase().startsWith(needle)) return i
  }
  return -1
}

// Where the menu goes: under the select, same width at least, flipped above
// when it does not fit below and there is more room above.
export function placeMenu(rect, menuHeight, viewportHeight, gap = 4, margin = 8) {
  const below = viewportHeight - rect.bottom - margin
  const above = rect.top - margin
  const flip = menuHeight > below && above > below
  const room = flip ? above : below
  const height = Math.min(menuHeight, Math.max(room - gap, 80))
  const top = flip ? rect.top - gap - height : rect.bottom + gap
  return { top, height, flip }
}
