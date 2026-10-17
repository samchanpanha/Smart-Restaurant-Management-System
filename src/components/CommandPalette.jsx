import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import StatusPill from './StatusPill'
import { NAV_SECTIONS, allowedScreens } from '../lib/constants'
import { translateDishName, translateScreenLabel, useI18n } from '../lib/i18n'
import { money } from '../lib/models'
import { useAuth } from '../lib/auth'
import { useRestora } from '../lib/store'

export function CommandPalette({ isOpen, onClose, onOpenShortcuts }) {
  const {
    state,
    screen,
    setScreen,
    role,
    locId,
    setLocId,
    locations,
    setSelectedTableId,
    setSelectedDishId,
    setSelectedOrderId,
  } = useRestora()

  const { screens } = useAuth()
  const { lang, dict } = useI18n()
  const cp = dict.commandPalette || {}
  const [query, setQuery] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' | 'screen' | 'menu' | 'table' | 'inventory' | 'action'
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const allowed = allowedScreens(role, screens)

  // Focus input when opened & reset search
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Build searchable commands list
  const allCommands = useMemo(() => {
    const list = []

    // 1. Screens
    const navItems = NAV_SECTIONS.flatMap((sec) => sec.items).filter((item) => allowed.includes(item.id))
    for (const nav of navItems) {
      const translated = translateScreenLabel(nav.id, nav.label, lang)
      list.push({
        id: `screen_${nav.id}`,
        type: 'screen',
        typeLabel: cp.types?.screen || 'Screen',
        icon: 'layers',
        title: translated,
        subtitle: `${cp.jumpTo || 'Jump to'} ${translated}`,
        keywords: `${nav.label} ${translated} ${nav.id}`.toLowerCase(),
        action: () => setScreen(nav.id),
      })
    }

    // 2. Menu Items
    const activeDishes = state.menu.filter((m) => m.active !== false)
    for (const dish of activeDishes) {
      const localName = translateDishName(dish, lang)
      list.push({
        id: `dish_${dish.id}`,
        type: 'menu',
        typeLabel: 'Dish',
        icon: 'menu',
        title: localName,
        subtitle: `${dish.category} · ${money(dish.price)}${dish.available ? '' : " (86'd)"}`,
        keywords: `${dish.name} ${localName} ${dish.category} ${dish.subCategory || ''} dish menu`.toLowerCase(),
        action: () => {
          setSelectedDishId(dish.id)
          setScreen('menu')
        },
      })
    }

    // 3. Tables
    for (const table of state.tables) {
      list.push({
        id: `table_${table.id}`,
        type: 'table',
        typeLabel: 'Table',
        icon: 'tables',
        title: table.name,
        subtitle: `${table.zone} · ${table.seats} seats · Status: ${table.status}`,
        keywords: `${table.name} ${table.zone} ${table.status} table seat`.toLowerCase(),
        action: () => {
          setSelectedTableId(table.id)
          setScreen('floor')
        },
      })
    }

    // 4. Inventory SKU items
    for (const inv of state.inventory) {
      list.push({
        id: `inv_${inv.id}`,
        type: 'inventory',
        typeLabel: 'Stock',
        icon: 'inventory',
        title: inv.name,
        subtitle: `${inv.category} · ${inv.onHand} ${inv.unit} · par: ${inv.par}`,
        keywords: `${inv.name} ${inv.category} stock inventory sku`.toLowerCase(),
        action: () => setScreen('inventory'),
      })
    }

    // 5. System Actions
    if (onOpenShortcuts) {
      list.push({
        id: 'action_shortcuts',
        type: 'action',
        typeLabel: cp.types?.action || 'Action',
        icon: 'sparkles',
        title: cp.actions?.shortcuts || 'Keyboard Shortcuts Cheat Sheet',
        subtitle: cp.actions?.shortcutsSub || 'View all keyboard shortcuts (?)',
        keywords: 'shortcuts hotkeys keyboard help cheat sheet',
        action: onOpenShortcuts,
      })
    }

    // Quick New Ticket
    if (allowed.includes('tickets')) {
      list.push({
        id: 'action_new_ticket',
        type: 'action',
        typeLabel: cp.types?.action || 'Action',
        icon: 'orders',
        title: cp.actions?.newTicket || 'New Dine-In / Takeout Ticket',
        subtitle: cp.actions?.newTicketSub || 'Open ticket composer to start an order',
        keywords: 'new ticket order start create',
        action: () => {
          setSelectedOrderId(null)
          setScreen('tickets')
        },
      })
    }

    // Quick 86 / Restore toggle
    if (allowed.includes('menu')) {
      list.push({
        id: 'action_86_board',
        type: 'action',
        typeLabel: cp.types?.action || 'Action',
        icon: 'menu',
        title: cp.actions?.eightySix || 'View 86 Board & Stock Outages',
        subtitle: cp.actions?.eightySixSub || 'Check dishes currently unavailable in the kitchen',
        keywords: '86 board out of stock unavailable',
        action: () => setScreen('menu'),
      })
    }

    // Branch Switchers
    if (locations && locations.length > 1) {
      for (const loc of locations) {
        if (loc.id !== locId) {
          list.push({
            id: `action_branch_${loc.id}`,
            type: 'action',
            typeLabel: cp.types?.action || 'Action',
            icon: 'building',
            title: cp.actions?.switchBranch ? cp.actions.switchBranch(loc.name) : `Switch Branch to: ${loc.name}`,
            subtitle: cp.actions?.switchBranchSub || `Switch workspace view to ${loc.name}`,
            keywords: `branch switch ${loc.name} location ${loc.short}`.toLowerCase(),
            action: () => setLocId(loc.id),
          })
        }
      }
    }

    return list
  }, [allowed, cp, lang, locId, locations, onOpenShortcuts, setLocId, setScreen, setSelectedDishId, setSelectedOrderId, setSelectedTableId, state.inventory, state.menu, state.tables])

  // Context-aware scoring: boost items matching current screen
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase()
    let results = allCommands

    if (filterType !== 'all') {
      results = results.filter((item) => item.type === filterType)
    }

    if (!q) {
      // Prioritize context-aware items based on active screen
      return results
        .slice()
        .sort((a, b) => {
          if (screen === 'floor' && a.type === 'table') return -1
          if (screen === 'floor' && b.type === 'table') return 1
          if (screen === 'tickets' && a.type === 'menu') return -1
          if (screen === 'tickets' && b.type === 'menu') return 1
          if (screen === 'inventory' && a.type === 'inventory') return -1
          if (screen === 'inventory' && b.type === 'inventory') return 1
          return 0
        })
        .slice(0, 15)
    }

    return results
      .filter((cmd) => cmd.keywords.includes(q))
      .sort((a, b) => {
        const aStarts = a.title.toLowerCase().startsWith(q)
        const bStarts = b.title.toLowerCase().startsWith(q)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1
        return 0
      })
      .slice(0, 20)
  }, [allCommands, filterType, query, screen])

  // Ensure active index is within bounds
  useEffect(() => {
    setActiveIndex(0)
  }, [query, filterType])

  // Keyboard navigation
  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = filteredCommands[activeIndex]
      if (selected) {
        selected.action()
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex]
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 sm:pt-24 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700 bg-[var(--color-ink-900)] text-zinc-100 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3.5 bg-[var(--color-ink-950)]">
          <Icon name="search" size={20} className="text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={cp.searchAll || cp.placeholder || "Type a command, search screens, dishes, tables, SKU..."}
            aria-label="Search command palette"
            className="w-full border-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
          <kbd className="hidden sm:inline-block rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            ESC
          </kbd>
        </div>

        {/* Filter Type Pills */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-zinc-800/80 px-4 py-2 text-xs bg-[var(--color-ink-950)]/50">
          {[
            ['all', cp.types?.all || 'All'],
            ['screen', cp.types?.screen || 'Screens'],
            ['menu', cp.types?.menu || 'Dishes'],
            ['table', cp.types?.table || 'Tables'],
            ['inventory', cp.types?.inventory || 'Stock'],
            ['action', cp.types?.action || 'Actions'],
          ].map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                filterType === type
                  ? 'bg-amber-500 text-stone-950 shadow-xs'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Command Results List */}
        <ul ref={listRef} className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filteredCommands.map((item, idx) => {
            const isSelected = idx === activeIndex

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    item.action()
                    onClose()
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-amber-500/15 text-white ring-1 ring-inset ring-amber-500/40'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-800 text-amber-400">
                      <Icon name={item.icon || 'search'} size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-sm leading-tight text-zinc-100">
                        {item.title}
                      </div>
                      <div className="truncate text-xs text-zinc-400 mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill tone="muted" size="sm">
                      {item.typeLabel}
                    </StatusPill>
                    {isSelected && (
                      <kbd className="hidden sm:inline-block rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
                        ↵
                      </kbd>
                    )}
                  </div>
                </button>
              </li>
            )
          })}

          {filteredCommands.length === 0 && (
            <li className="py-10 text-center text-sm text-zinc-500">
              {cp.noResults || `No results found for "${query}". Try another search term.`}
            </li>
          )}
        </ul>

        {/* Footer shortcuts helper */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-[var(--color-ink-950)] px-4 py-2.5 text-[11px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">↵</kbd> select
            </span>
            <span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">esc</kbd> close
            </span>
          </div>
          <span className="text-zinc-400">Restora Command Palette</span>
        </div>
      </div>
    </div>
  )
}
