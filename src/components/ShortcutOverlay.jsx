import { useEffect } from 'react'
import { useI18n } from '../lib/i18n'

export function ShortcutOverlay({ isOpen, onClose }) {
  const { dict } = useI18n()
  const so = dict.shortcutsOverlay || {}
  const sec = so.sections || {}
  const k = so.keys || {}

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sections = [
    {
      title: sec.global || 'Global & Navigation',
      items: [
        { keys: ['⌘', 'K'], label: k.commandPalette || 'Open Command Palette' },
        { keys: ['?'], label: k.cheatSheet || 'Show this keyboard shortcuts cheat sheet' },
        { keys: ['Alt', '1…9'], label: k.switchTab || 'Switch between open workspace tabs' },
        { keys: ['Ctrl', 'W'], label: k.closeTab || 'Close active workspace tab' },
        { keys: ['Esc'], label: k.closeModal || 'Close active modal or dismiss search' },
      ],
    },
    {
      title: sec.live || 'Live Service & Tickets',
      items: [
        { keys: ['N'], label: k.newTicket || 'New ticket (quick-add mode)' },
        { keys: ['F'], label: k.fireHeld || 'Fire all held kitchen items immediately' },
        { keys: ['B'], label: k.billTable || 'Bill / print receipt for active table' },
        { keys: ['P'], label: k.payTicket || 'Pay and close active ticket' },
        { keys: ['S'], label: k.seatGuest || 'Seat guest / select table on floor' },
      ],
    },
    {
      title: sec.kitchen || 'Kitchen & Display (KDS)',
      items: [
        { keys: ['Enter'], label: k.bumpKds || 'Bump oldest active kitchen ticket' },
        { keys: ['R'], label: k.recallKds || 'Recall most recently bumped kitchen ticket' },
        { keys: ['8'], label: k.board86 || 'Open 86 dish availability board' },
      ],
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="surface-dark w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700 bg-[var(--surface)] text-zinc-100 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[var(--surface-sunken)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⌨️</span>
            <div>
              <h2 className="text-base font-bold text-zinc-100">{so.title || 'Keyboard Shortcuts'}</h2>
              <p className="text-xs text-zinc-400">{so.subtitle || 'Boost your workflow velocity during service'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close shortcuts"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3">
                {section.title}
              </h3>
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-300">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-center font-mono text-xs font-semibold text-zinc-200 shadow-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-[var(--surface-sunken)] px-6 py-3 text-xs text-zinc-500">
          <span>Press <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[11px]">?</kbd> anywhere to open</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-3 py-1 font-semibold text-zinc-300 hover:bg-zinc-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
