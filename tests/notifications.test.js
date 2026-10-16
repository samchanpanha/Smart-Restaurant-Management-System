// ─── Notifications, and the dialogs that replaced the browser's ───────
//
// The app used to answer with window.alert / window.prompt / window.confirm:
// native dialogs that block a tablet, look broken in a dark workspace, and
// cannot be styled. These tests hold the replacements in place — a toast
// that a screen can raise, and a real dialog for a real decision.

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/?role=owner',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'location', 'history']) {
  globalThis[key] = dom.window[key]
}
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.sessionStorage = dom.window.sessionStorage
globalThis.requestAnimationFrame = (cb) => dom.window.setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = globalThis.ResizeObserver
globalThis.HTMLElement.prototype.scrollTo = function scrollTo() {}
globalThis.HTMLElement.prototype.setPointerCapture = function setPointerCapture() {}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
dom.window.matchMedia = globalThis.matchMedia
globalThis.fetch = async () => { throw new Error('offline') }
globalThis.EventSource = class { constructor() { this.readyState = 0 } addEventListener() {} close() {} }
globalThis.print = () => {}
globalThis.open = () => null
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { RestoraProvider } = await server.ssrLoadModule('/src/lib/store.jsx')
const { ConfirmProvider } = await server.ssrLoadModule('/src/components/ui/ConfirmProvider.jsx')
const { useConfirm } = await server.ssrLoadModule('/src/components/ui/confirm-context.js')
const { ToastProvider } = await server.ssrLoadModule('/src/components/ui/Toast.jsx')
const { useToast } = await server.ssrLoadModule('/src/components/ui/toast-context.js')
const { default: SuppliersScreen } = await server.ssrLoadModule('/src/screens/SuppliersScreen.jsx')

after(async () => {
  await server.close()
  dom.window.close()
})

// ─── The toast ─────────────────────────────────────────────────────

function Raiser() {
  const { notify } = useToast()
  return React.createElement(
    'button',
    { type: 'button', onClick: () => notify('Saved to the till roll.', 'success') },
    'raise',
  )
}

test('a screen can raise a message the operator can read', async () => {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(React.createElement(ToastProvider, null, React.createElement(Raiser)))
  })

  assert.equal(host.textContent.includes('Saved to the till roll.'), false, 'nothing is said before it happens')

  await act(async () => {
    host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  assert.ok(host.textContent.includes('Saved to the till roll.'), 'the message is shown')
  const live = host.querySelector('[aria-live="polite"]')
  assert.ok(live, 'the message is announced politely')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

test('the message can be dismissed by hand', async () => {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(React.createElement(ToastProvider, null, React.createElement(Raiser)))
  })
  await act(async () => {
    host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.ok(host.textContent.includes('Saved to the till roll.'))

  const dismiss = host.querySelector('[aria-label="Dismiss"]')
  assert.ok(dismiss, 'there is a way to close the message')
  await act(async () => {
    dismiss.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(host.textContent.includes('Saved to the till roll.'), false, 'the message is gone')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

// ─── The delete dialog ─────────────────────────────────────────────

const findButton = (host, label) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent.trim() === label)

test('deleting a supplier asks first, in a dialog of our own', async () => {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(RestoraProvider, null, React.createElement(SuppliersScreen)),
      ),
    )
  })

  // Any native dialog from here on is a failure: they block a tablet and
  // cannot be styled.
  const native = []
  for (const name of ['alert', 'confirm', 'prompt']) {
    dom.window[name] = () => {
      native.push(name)
      throw new Error(`native ${name} was used`)
    }
  }

  const del = findButton(host, 'Delete')
  assert.ok(del, 'the delete button is there')

  await act(async () => {
    del.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  const dialog = dom.window.document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'a dialog opened')
  assert.ok(dialog.textContent.includes('Delete supplier'), 'the dialog names the decision')
  assert.ok(dialog.textContent.includes('Cancel'), 'the dialog can be called off')
  assert.deepEqual(native, [], 'no native dialog was used')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

// ─── The confirm dialog ───────────────────────────────────────────

function Asker({ onAnswer }) {
  const confirm = useConfirm()
  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: async () => {
        const answer = await confirm({ title: 'Delete this table?', body: 'It leaves the floor plan.', confirmLabel: 'Delete table', tone: 'danger' })
        onAnswer(answer)
      },
    },
    'ask',
  )
}

test('a destructive action asks in the app\'s own dialog', async () => {
  const answers = []
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      React.createElement(
        ConfirmProvider,
        null,
        React.createElement(Asker, { onAnswer: (answer) => answers.push(answer) }),
      ),
    )
  })

  await act(async () => {
    host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  const dialog = dom.window.document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'the question is asked in a dialog')
  assert.ok(dialog.textContent.includes('Delete this table?'), 'the question is named')
  assert.ok(dialog.textContent.includes('It leaves the floor plan.'), 'the consequence is explained')

  // Cancelling says no.
  const cancel = [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Cancel')
  assert.ok(cancel, 'the question can be called off')
  await act(async () => {
    cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.deepEqual(answers, [false], 'cancelling means no')

  // Agreeing says yes.
  await act(async () => {
    host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  const accept = dom.window.document.querySelector('[data-testid="confirm-accept"]')
  assert.ok(accept, 'the dialog offers the action')
  await act(async () => {
    accept.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.deepEqual(answers, [false, true], 'agreeing means yes')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

test('a screen with no dialog host never acts on its own', async () => {
  // Outside a ConfirmProvider the hook answers no, so a screen rendered on
  // its own cannot delete anything.
  const answers = []
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(React.createElement(Asker, { onAnswer: (answer) => answers.push(answer) }))
  })
  await act(async () => {
    host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  assert.deepEqual(answers, [false], 'no dialog, no action')
  assert.equal(dom.window.document.querySelector('[role="dialog"]'), null)

  await act(async () => {
    root.unmount()
  })
  host.remove()
})
