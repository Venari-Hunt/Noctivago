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
//   actions: [{ label, onClick, icon? }] buttons; clicking one also closes it.
//        icon: a mock icon name drawn before the label (Undo uses 'undo-2').
//   onClose: called once however it closes (timeout, Dismiss, an action,
//        replaced by the same key, or pushed out of a full stack).
//
// Desktop 2.0 step 18: drawn as the mock's toast (screens "notify" and
// "undo"), centered above the player bar.

import { mockIconSvg } from '../components/mockIcons.jsx'

const MAX_VISIBLE = 4
const byKey = new Map()
const closers = new WeakMap()
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

export function notify({ message, title, tone = 'info', key, timeoutMs, actions = [], onClose }) {
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
      button.className = 'btn btn-icon-text'
      if (action.icon) button.insertAdjacentHTML('afterbegin', mockIconSvg(action.icon))
      button.append(action.label)
      // The action runs before close(), so an onClose can tell "closed by
      // this action" (Undo) from "timed out".
      button.addEventListener('click', () => {
        action.onClick?.()
        close()
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
  closeButton.innerHTML = mockIconSvg('x')
  closeButton.addEventListener('click', () => close())

  card.append(body, closeButton)

  let timer = null
  const arm = () => {
    if (timeoutMs > 0) timer = setTimeout(close, timeoutMs)
  }
  card.addEventListener('mouseenter', () => clearTimeout(timer))
  card.addEventListener('mouseleave', arm)

  let closed = false
  function close() {
    clearTimeout(timer)
    card.remove()
    if (key && byKey.get(key)?.card === card) byKey.delete(key)
    if (closed) return
    closed = true
    onClose?.()
  }
  closers.set(card, close)

  const previous = key ? byKey.get(key) : null
  if (previous?.card.isConnected) {
    previous.card.replaceWith(card)
    previous.cancel()
    closers.get(previous.card)?.()
  } else {
    host.appendChild(card)
    // Oldest first out once the stack is full.
    while (host.children.length > MAX_VISIBLE) {
      const oldest = host.firstElementChild
      const closeOldest = closers.get(oldest)
      if (closeOldest) closeOldest()
      else oldest.remove()
    }
  }
  if (key) byKey.set(key, { card, cancel: () => clearTimeout(timer) })
  arm()
  return { close }
}
