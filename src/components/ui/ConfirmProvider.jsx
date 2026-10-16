// ─── Confirming an action ────────────────────────────────────────────
//
// A native window.confirm freezes a tablet, cannot be styled, and reads
// like a bug in a dark workspace. This is the app's own answer: a dialog
// in the house style, with the same focus handling as every other modal.
//
// One provider serves the whole app. A screen asks:
//
//   const confirm = useConfirm()
//   if (!(await confirm({ title: 'Delete this table?', body: '…' }))) return
//
// and the dialog is rendered by the provider, so no screen has to own
// dialog state.

import { useCallback, useState } from 'react'
import { Modal } from './Overlay'
import { ConfirmContext } from './confirm-context'

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setRequest({
          title: 'Are you sure?',
          body: '',
          confirmLabel: 'Confirm',
          cancelLabel: 'Cancel',
          tone: 'default',
          ...options,
          resolve,
        })
      }),
    [],
  )

  const answer = useCallback(
    (value) => {
      setRequest((current) => {
        current?.resolve(value)
        return null
      })
    },
    [],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          title={request.title}
          onClose={() => answer(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => answer(false)}
                className="min-h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                {request.cancelLabel}
              </button>
              <button
                type="button"
                data-testid="confirm-accept"
                onClick={() => answer(true)}
                className={`min-h-10 rounded-xl px-4 text-sm font-bold text-white transition-colors ${
                  request.tone === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-orange-500 hover:bg-orange-600'
                }`}
              >
                {request.confirmLabel}
              </button>
            </>
          }
        >
          {request.body ? <p className="text-sm leading-relaxed text-zinc-600">{request.body}</p> : null}
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
