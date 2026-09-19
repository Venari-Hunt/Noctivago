// In-app notifications: a small stack in the bottom-left corner of the main
// window. The rule they exist for: anything the app does without being asked
// (a plugin updating itself in the background, the startup plugin download)
// says so here. Plugins get the same call as app.notifications.show().
//
// notify({ message, title?, tone?, key?, timeoutMs?, actions? }) -> { close }
//   tone: 'info' (default) | 'success' | 'error'
//   key: a notification with the same key replaces the old one in place
//        (e.g. "waiting to update" -> "updated")
//   timeoutMs: auto-close after this long; hovering pauses it. Omitted = it
//        stays until closed, for things that may happen while nobody's
//        looking (the app often runs all night).
//   actions: [{ label, onClick }] buttons; clicking one also closes it.

const MAX_VISIBLE = 4
const byKey = new Map()
let stack = null

function ensureStack() {
  if (stack?.isConnected) return stack
  stack = document.createElement('div')
  stack.className = 'notify-stack'
  stack.setAttribute('role', 'status')
  stack.setAttribute('aria-live', 'polite')
  document.body.appendChild(stack)
  return stack
}

export function notify({ message, title, tone = 'info', key, timeoutMs, actions = [] }) {
  const host = ensureStack()
  const card = document.createElement('div')
  card.className = `notify notify-${tone}`

  const body = document.createElement('div')
  body.className = 'notify-body'
  if (title) {
    const t = document.createElement('div')
    t.className = 'notify-title'
    t.textContent = title
    body.appendChild(t)
  }
  const m = document.createElement('div')
  m.className = 'notify-message'
  m.textContent = message
  body.appendChild(m)

  if (actions.length) {
    const row = document.createElement('div')
    row.className = 'notify-actions'
    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn btn-small'
      button.textContent = action.label
      button.addEventListener('click', () => {
        close()
        action.onClick?.()
      })
      row.appendChild(button)
    }
    body.appendChild(row)
  }

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'notify-close'
  closeButton.title = 'Dismiss'
  closeButton.setAttribute('aria-label', 'Dismiss')
  closeButton.textContent = '✕'
  closeButton.addEventListener('click', () => close())

  card.append(body, closeButton)

  let timer = null
  const arm = () => {
    if (timeoutMs > 0) timer = setTimeout(close, timeoutMs)
  }
  card.addEventListener('mouseenter', () => clearTimeout(timer))
  card.addEventListener('mouseleave', arm)

  function close() {
    clearTimeout(timer)
    card.remove()
    if (key && byKey.get(key)?.card === card) byKey.delete(key)
  }

  const previous = key ? byKey.get(key) : null
  if (previous?.card.isConnected) {
    previous.card.replaceWith(card)
    previous.cancel()
  } else {
    host.appendChild(card)
    // Oldest first out once the stack is full.
    while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove()
  }
  if (key) byKey.set(key, { card, cancel: () => clearTimeout(timer) })
  arm()
  return { close }
}
