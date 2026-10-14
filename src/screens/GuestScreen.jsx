// ─── Guest QR ordering ────────────────────────────────────────────
// Scan the table tent → menu → send → live status → pay. Guest lines
// land on the SAME ticket the server and KDS see (tagged QR). Light,
// consumer-friendly surface — the opposite of the dark ops screens.

import { useMemo, useState } from 'react'
import LanguageSwitcher from '../components/LanguageSwitcher'
import {
  translateCategory,
  translateDishName,
  translateModifier,
  translateTableName,
  useDomTranslator,
  useI18n,
} from '../lib/i18n'
import { money, orderTotals } from '../lib/models'
import { useMenuCatalog } from '../lib/useMenuCatalog'
import { useNow, useRestora } from '../lib/store'

const DESC = {
  m_salad: 'Crisp greens, tomato, house dressing. Tossed to order.',
  m_wings: 'Grill-fired wings, pick your sauce. Eight-minute fire.',
  m_soup: 'Rotating daily pot from the steam table. Ask your server.',
  m_burger: 'Smashed patty, cheddar, brioche, fries on the plate.',
  m_salmon: 'Crisp-skin fillet with market sides. When the boat comes in.',
  m_chickenpasta: 'Grilled chicken over cream pasta. The safe delicious bet.',
  m_steak: 'Ribeye with fries. Rested five minutes, worth it.',
  m_fishchips: 'Crisp fish, proper fries, lemon. Friday energy.',
  m_vegbowl: 'Garden bowl, light but not sad.',
  m_cake: 'Chocolate cake, plated. Save room.',
  m_icecream: 'Two scoops. No wrong answers.',
  m_soda: 'Ice-cold can.',
  m_coffee: 'Bottomless-ish dinner coffee.',
}

const courseFor = (menu) =>
  menu.category === 'Starters' ? 'appetizer' : menu.category === 'Desserts' ? 'dessert' : 'main'

function openOrderFor(state, tableId) {
  return state.orders.find((o) => o.tableId === tableId && !['paid', 'void'].includes(o.status))
}

function paidOrderFor(state, tableId) {
  return state.orders
    .filter((o) => o.tableId === tableId && o.status === 'paid')
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0]
}

// ─── Dish detail (modifiers, qty) ─────────────────────────────────

function DishModal({ item, onAdd, onClose, showImages = true }) {
  const { lang } = useI18n()
  const [picks, setPicks] = useState({})
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')
  const required = (item.modifiers || []).filter((g) => g.required)
  const ready = required.every((g) => picks[g.id])
  const dishTitle = translateDishName(item, lang)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {showImages && item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true }}
            className="mb-4 h-44 w-full rounded-2xl object-cover"
          />
        )}
        <h2 className="text-xl font-extrabold text-stone-900">
          {dishTitle}
          {lang !== 'en' && <span className="sr-only"> {item.name}</span>}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-500">{item.description || DESC[item.id] || 'Prepared fresh to order.'}</p>
        <div className="tnum mt-2 text-lg font-extrabold text-amber-700">{money(item.price)}</div>
        {!!item.dietaryTags?.length && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.dietaryTags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800">{tag}</span>)}
          </div>
        )}
        {!!item.allergens?.length && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            Allergen notes: {item.allergens.join(', ')}. Ask the team about ingredients and cross-contact.
          </p>
        )}

        {(item.modifiers || []).map((g) => (
          <div key={g.id} className="mt-4">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-stone-500">
              {g.label}{g.required ? ' · pick one' : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [g.id]: opt }))}
                  className={`min-h-[44px] rounded-full px-4 text-sm font-bold transition-colors ${
                    picks[g.id] === opt ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {translateModifier(opt, lang)}
                  {lang !== 'en' && <span className="sr-only"> {opt}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-stone-500">Qty</span>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Decrease" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-xl font-bold">−</button>
            <span className="tnum w-6 text-center text-xl font-extrabold">{qty}</span>
            <button type="button" aria-label="Increase" onClick={() => setQty((q) => Math.min(12, q + 1))} className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-xl font-bold">+</button>
          </div>
        </div>

        <input
          value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={80}
          placeholder="Note for the kitchen (optional)"
          className="mt-4 min-h-[44px] w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm"
        />

        <button
          type="button" disabled={!ready}
          onClick={() => onAdd({ modifiers: Object.entries(picks).map(([id, value]) => ({ id, value })), qty, notes })}
          className="mt-4 min-h-[52px] w-full rounded-2xl bg-amber-500 text-base font-extrabold text-stone-950 hover:bg-amber-400 disabled:opacity-40"
        >
          {ready ? `Add ${qty} · ${money(item.price * qty)}` : 'Pick required options'}
        </button>
        <button type="button" onClick={onClose} className="mt-2 min-h-[44px] w-full rounded-2xl text-sm font-bold text-stone-500">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Pay sheet ────────────────────────────────────────────────────

function PaySheet({ order, onClose, onPaid }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const t = orderTotals(order, menuById, state.settings.taxPct)
  const [tipPct, setTipPct] = useState(18)
  const [customTip, setCustomTip] = useState('')
  const tip = customTip !== '' ? Math.max(0, Number(customTip) || 0) : (t.subtotal * tipPct) / 100

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Pay check" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-extrabold text-stone-900">Your check</h2>
        <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto text-sm">
          {t.lines.map((l) => (
            <li key={l.id} className="flex justify-between text-stone-700">
              <span>{l.qty}× {l.name}</span>
              <span className="tnum font-bold">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between text-stone-500"><span>Subtotal</span><span className="tnum">{money(t.subtotal)}</span></div>
          <div className="flex justify-between text-stone-500"><span>Tax</span><span className="tnum">{money(t.tax)}</span></div>
        </div>

        <div className="mt-4 text-xs font-bold uppercase tracking-widest text-stone-500">Tip the team</div>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {[10, 15, 18, 22].map((p) => (
            <button
              key={p} type="button"
              onClick={() => { setTipPct(p); setCustomTip('') }}
              className={`min-h-[44px] rounded-xl text-sm font-extrabold ${customTip === '' && tipPct === p ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'}`}
            >
              {p}%
            </button>
          ))}
        </div>
        <input
          value={customTip} onChange={(e) => setCustomTip(e.target.value)} type="number" min="0" step="any"
          placeholder="Custom tip $" className="tnum mt-2 min-h-[44px] w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm"
        />

        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'PAY_ORDER', orderId: order.id, method: 'card', tip: Math.round(tip * 100) / 100, split: { kind: 'full', by: 'guest' } })
            onPaid()
          }}
          className="tnum mt-4 min-h-[52px] w-full rounded-2xl bg-amber-500 text-base font-extrabold text-stone-950 hover:bg-amber-400"
        >
          Pay {money(t.total + tip)}
        </button>
        <p className="mt-2 text-center text-[11px] text-stone-400">Demo checkout — no card is charged.</p>
      </div>
    </div>
  )
}

// ─── Guest app ────────────────────────────────────────────────────

export default function GuestScreen({ tableId }) {
  const { state, dispatch, locId, link } = useRestora()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const gu = dict.guest || {}
  const { items: catalogMenu } = useMenuCatalog(state.menu, locId, link.status)
  useNow(5000)
  const [tab, setTab] = useState('menu')
  const [cat, setCat] = useState('Mains')
  const [cart, setCart] = useState([])
  const [guestName, setGuestName] = useState('')
  const [detail, setDetail] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [justSent, setJustSent] = useState(false)

  const table = state.tables.find((t) => t.id === tableId)
  const order = table ? openOrderFor(state, tableId) : null
  const paid = table ? paidOrderFor(state, tableId) : null
  const menuById = useMemo(() => Object.fromEntries(catalogMenu.map((m) => [m.id, m])), [catalogMenu])
  const activeMenu = useMemo(() => catalogMenu.filter((m) => m.active !== false), [catalogMenu])
  const cats = useMemo(() => [...new Set(activeMenu.map((m) => m.category))], [activeMenu])
  const available = activeMenu.filter((m) => m.available && (m.category === cat || cat === 'All'))

  const myLines = order ? order.items.filter((i) => i.by === 'guest' && !i.voided) : []
  const cartTotal = cart.reduce((s, c) => s + (menuById[c.menuItemId]?.price || 0) * c.qty, 0)
  const cartCount = cart.reduce((s, c) => s + c.qty, 0)

  function addToCart(menuItem, extra) {
    setCart((c) => [...c, {
      key: `${menuItem.id}-${Date.now()}-${c.length}`,
      menuItemId: menuItem.id, course: courseFor(menuItem), ...extra,
    }])
    setDetail(null)
  }

  function sendCart() {
    if (!cart.length) return
    dispatch({
      type: 'GUEST_SEND',
      tableId,
      items: cart.map((c) => ({ ...c, guest: guestName.trim() || null })),
    })
    setCart([])
    setCartOpen(false)
    setJustSent(true)
    setTab('status')
    window.setTimeout(() => setJustSent(false), 5000)
    // The Telegram mini app listens for this to fire a haptic tap and to
    // collapse its cart sheet; in a plain browser nobody is listening.
    window.dispatchEvent(new CustomEvent('restora:order-sent', { detail: { tableId } }))
  }

  // Photo policy lives in Settings → Food & menu so a slow connection can
  // keep the guest page lean.
  const guestPhotos = state.settings?.food?.imagesOnGuestMenu !== false

  const shell = (inner) => (
    <div className="min-h-screen bg-[#faf6ef] text-stone-900">
      <div className="mx-auto max-w-md px-4 pb-32 pt-6">{inner}</div>
    </div>
  )

  if (!table) {
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🧾</div>
        <h1 className="mt-3 text-xl font-extrabold">Hmm, that code didn&apos;t scan.</h1>
        <p className="mt-1 text-sm text-stone-500">Try the tent card on your table again, or ask your server.</p>
      </div>,
    )
  }

  if (table.status === 'billed' || (paid && !order)) {
    const t = paid ? orderTotals(paid, menuById, state.settings.taxPct) : null
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🎉</div>
        <h1 className="mt-3 text-xl font-extrabold">Thanks for dining with us!</h1>
        <p className="mt-1 text-sm text-stone-500">{table.name} · check closed {paid?.paidAt ? new Date(paid.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
        {t && (
          <div className="tnum mt-4 rounded-2xl bg-stone-50 p-4 text-sm">
            <div className="flex justify-between"><span>Food & tax</span><strong>{money(t.total)}</strong></div>
            {(paid.tip || 0) > 0 && <div className="flex justify-between"><span>Tip</span><strong>{money(paid.tip)}</strong></div>}
            <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-extrabold">
              <span>Total</span><span>{money(t.total + (paid.tip || 0))}</span>
            </div>
          </div>
        )}
      </div>,
    )
  }

  if (!['seated', 'ordered'].includes(table.status)) {
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🪑</div>
        <h1 className="mt-3 text-xl font-extrabold">{translateTableName(table.name, lang)}{lang === 'km' ? ' មិនទាន់បានដាក់ភ្ញៀវអង្គុយទេ។' : lang === 'zh' ? ' 尚未入座。' : " isn't seated yet."}{lang !== 'en' && <span className="sr-only"> {table.name} isn&apos;t seated yet.</span>}</h1>
        <p className="mt-1 text-sm text-stone-500">{lang === 'km' ? 'បុគ្គលិកទទួលភ្ញៀវនឹងដាក់លោកអ្នកអង្គុយ បន្ទាប់មកមុខម្ហូបនេះនឹងបើក។ ការរង់ចាំគឺមានតម្លៃ។' : lang === 'zh' ? '接待员安排入座后，菜单即会解锁。等待是值得的。' : 'Your host will seat you, then this menu unlocks. The wait is worth it.'}</p>
      </div>,
    )
  }

  const heldAny = order ? order.items.some((i) => i.status === 'held' && !i.voided) : false
  const payable = order && ['sent', 'in_prep', 'ready', 'served'].includes(order.status) && !heldAny
  const bill = order ? orderTotals(order, menuById, state.settings.taxPct) : null

  return (
    <div className="min-h-screen bg-[#faf6ef] text-stone-900">
      <div className="mx-auto max-w-md px-4 pb-36 pt-5">
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher compact testIdPrefix="guest-lang" />
        </div>
        <header className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-amber-700">
              {gu.orderAtTable || 'Restora · order at table'}
              {lang !== 'en' && <span className="sr-only"> Restora · order at table</span>}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {translateTableName(table.name, lang)}
              {lang !== 'en' && <span className="sr-only"> {table.name}</span>}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'CALL_SERVER', tableId })}
            className="min-h-[44px] rounded-full border border-stone-200 bg-white px-4 text-sm font-bold text-stone-700 shadow-sm"
          >
            🙋 {gu.callServer || 'Call server'}
            {lang !== 'en' && <span className="sr-only"> Call server</span>}
          </button>
        </header>

        <input
          value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={24}
          placeholder={gu.yourName || 'Your name (optional — helps the kitchen)'}
          className="mt-3 min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm"
        />

        {justSent && (
          <div className="mt-3 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow" role="status">
            {gu.sentToKitchen || 'Sent to the kitchen — watch it here live. 🔥'}
          </div>
        )}

        {tab === 'menu' && (
          <>
            <div className="sticky top-0 z-10 -mx-4 mt-4 bg-[#faf6ef]/95 px-4 py-2 backdrop-blur">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {cats.map((c) => (
                  <button
                    key={c} type="button" onClick={() => setCat(c)}
                    className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-bold ${cat === c ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 shadow-sm'}`}
                  >
                    {translateCategory(c, lang)}
                    {lang !== 'en' && <span className="sr-only"> {c}</span>}
                  </button>
                ))}
              </div>
            </div>
            <ul className="mt-2 space-y-2.5">
              {available.map((m) => (
                <li key={m.id}>
                  <button
                    type="button" onClick={() => setDetail(m)}
                    className="w-full rounded-3xl bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
                  >
                    {guestPhotos && m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => { event.currentTarget.hidden = true }}
                        className="mb-3 h-36 w-full rounded-2xl object-cover"
                      />
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-extrabold">
                          {translateDishName(m, lang)}
                          {lang !== 'en' && <span className="sr-only"> {m.name}</span>}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-stone-500">{m.description || DESC[m.id] || 'Prepared fresh to order.'}</div>
                      </div>
                      <div className="tnum shrink-0 font-extrabold text-amber-700">{money(m.price)}</div>
                    </div>
                    {!!m.dietaryTags?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.dietaryTags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{tag}</span>)}
                      </div>
                    )}
                    {!!m.allergens?.length && (
                      <div className="mt-1.5 text-[10px] font-semibold text-amber-800">Allergen notes · {m.allergens.join(', ')}</div>
                    )}
                  </button>
                </li>
              ))}
              {available.length === 0 && (
                <li className="rounded-3xl bg-white p-6 text-center text-sm text-stone-500">
                  Everything in {translateCategory(cat, lang)} is 86&apos;d right now — the kitchen will fix it. Try another craving.
                </li>
              )}
            </ul>
            <p className="mt-3 text-center text-[11px] text-stone-400">
              Dishes the kitchen 86&apos;s disappear from this menu instantly.
            </p>
          </>
        )}

        {tab === 'status' && (
          <div className="mt-4 space-y-2.5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-500">{gu.yourOrders || 'Your orders · live'}</h2>
            {myLines.length === 0 && (
              <div className="rounded-3xl bg-white p-6 text-center text-sm text-stone-500 shadow-sm">
                Nothing sent yet — <button type="button" onClick={() => setTab('menu')} className="font-bold text-amber-700 underline">browse the menu</button>.
              </div>
            )}
            {myLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-3xl bg-white p-4 shadow-sm">
                <div>
                  <div className="font-extrabold">
                    {l.qty}× {translateDishName(menuById[l.menuItemId] || { id: l.menuItemId, name: l.menuItemId }, lang)}
                    {lang !== 'en' && <span className="sr-only"> {menuById[l.menuItemId]?.name}</span>}
                  </div>
                  <div className="text-xs text-stone-500">
                    {(l.modifiers || []).map((m) => translateModifier(m.value, lang)).join(' · ')}
                    {l.comped && ' · on the house 🎁'}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold ${
                  l.status === 'bump' ? 'bg-emerald-100 text-emerald-800' : l.status === 'fired' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'
                }`}>
                  {l.status === 'bump' ? '✓ Ready' : l.status === 'fired' ? '🔥 In kitchen' : 'Held'}
                </span>
              </div>
            ))}
            {order && order.billRequested && (
              <div className="rounded-3xl bg-violet-600 p-4 text-center text-sm font-bold text-white shadow">
                Your server is on the way with the card reader. 💳
              </div>
            )}
          </div>
        )}

        {tab === 'bill' && (
          <div className="mt-4 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-500">{gu.tableCheck || 'Table check'}</h2>
            {!order || bill.lines.length === 0 ? (
              <div className="rounded-3xl bg-white p-6 text-center text-sm text-stone-500 shadow-sm">
                Nothing on the check yet.
              </div>
            ) : (
              <>
                <div className="rounded-3xl bg-white p-5 shadow-sm">
                  <ul className="space-y-1.5 text-sm">
                    {bill.lines.map((l) => (
                      <li key={l.id} className="flex justify-between text-stone-700">
                        <span>{l.qty}× {translateDishName(menuById[l.menuItemId] || { id: l.menuItemId, name: l.name }, lang)}{l.by !== 'guest' && <span className="text-stone-400"> (server)</span>}</span>
                        <span className="tnum font-bold">{money(l.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
                    <div className="flex justify-between text-stone-500"><span>{gu.subtotal || 'Subtotal'}</span><span className="tnum">{money(bill.subtotal)}</span></div>
                    <div className="flex justify-between text-stone-500"><span>{gu.tax || 'Tax'}</span><span className="tnum">{money(bill.tax)}</span></div>
                    <div className="flex justify-between text-base font-extrabold"><span>{gu.total || 'Total due'}</span><span className="tnum">{money(bill.total)}</span></div>
                  </div>
                </div>
                {payable ? (
                  <>
                    <button
                      type="button" onClick={() => setPayOpen(true)}
                      className="min-h-[52px] w-full rounded-2xl bg-stone-900 text-base font-extrabold text-white"
                    >
                      Pay {money(bill.total)} + tip
                    </button>
                    <button
                      type="button" onClick={() => dispatch({ type: 'REQUEST_BILL', orderId: order.id })}
                      disabled={!!order.billRequested}
                      className="min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white text-sm font-bold text-stone-600 disabled:opacity-50"
                    >
                      {order.billRequested ? 'Server notified ✓' : 'Ask server to take payment instead'}
                    </button>
                  </>
                ) : (
                  <div className="rounded-3xl bg-white p-4 text-center text-sm text-stone-500 shadow-sm">
                    {order.status === 'open' || heldAny
                      ? 'Your server is still adding items — the bill unlocks when everything is in.'
                      : 'Check is closing — one moment.'}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Bottom nav + cart bar */}
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md bg-white/95 px-4 pb-5 pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur" aria-label="Guest navigation">
          {cartCount > 0 && (
            <button
              type="button" onClick={() => setCartOpen(true)}
              className="tnum mb-2 flex min-h-[52px] w-full items-center justify-between rounded-2xl bg-amber-500 px-5 text-base font-extrabold text-stone-950"
            >
              <span>{gu.viewOrder || 'View order'} · {cartCount} item{cartCount === 1 ? '' : 's'}</span>
              <span>{money(cartTotal)} →</span>
            </button>
          )}
          <div className="grid grid-cols-3 gap-1">
            {[
              ['menu', gu.menuTab || '🍽 Menu', '🍽 Menu'],
              ['status', `${gu.statusTab || '🔥 Status'}${myLines.filter((l) => l.status === 'fired').length ? ` (${myLines.filter((l) => l.status === 'fired').length})` : ''}`, '🔥 Status'],
              ['bill', gu.billTab || '🧾 Bill', '🧾 Bill'],
            ].map(([id, label, enLabel]) => (
              <button
                key={id} type="button" onClick={() => setTab(id)}
                className={`min-h-[44px] rounded-2xl text-sm font-extrabold ${tab === id ? 'bg-stone-900 text-white' : 'text-stone-500'}`}
              >
                {label}
                {lang !== 'en' && <span className="sr-only"> {enLabel}</span>}
              </button>
            ))}
          </div>
        </nav>

        {detail && (
          <DishModal item={detail} showImages={guestPhotos} onClose={() => setDetail(null)} onAdd={(extra) => addToCart(detail, extra)} />
        )}

        {cartOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Your order" onClick={() => setCartOpen(false)}>
            <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-xl font-extrabold">Your order · {table.name}</h2>
              {guestName.trim() && <p className="text-sm text-stone-500">Sending as {guestName.trim()}</p>}
              <ul className="mt-3 space-y-2">
                {cart.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-2 rounded-2xl bg-stone-50 p-3">
                    <div className="text-sm">
                      <div className="font-extrabold">{c.qty}× {menuById[c.menuItemId]?.name}</div>
                      <div className="text-xs text-stone-500">
                        {(c.modifiers || []).map((m) => m.value).join(' · ')}
                        {c.notes ? ` · “${c.notes}”` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tnum text-sm font-extrabold">{money((menuById[c.menuItemId]?.price || 0) * c.qty)}</span>
                      <button
                        type="button" aria-label="Remove" onClick={() => setCart((list) => list.filter((x) => x.key !== c.key))}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-200 text-lg"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button" onClick={sendCart} disabled={!cart.length}
                className="tnum mt-4 min-h-[52px] w-full rounded-2xl bg-amber-500 text-base font-extrabold text-stone-950 disabled:opacity-40"
              >
                Send to kitchen · {money(cartTotal)}
              </button>
              <p className="mt-2 text-center text-[11px] text-stone-400">Fires straight to the KDS — same as your server sending it.</p>
            </div>
          </div>
        )}

        {payOpen && order && (
          <PaySheet order={order} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); setTab('bill') }} />
        )}
      </div>
    </div>
  )
}
