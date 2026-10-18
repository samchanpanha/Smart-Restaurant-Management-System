// ─── Guest QR ordering ────────────────────────────────────────────
// Scan the table tent → menu → send → live status → pay. Guest lines
// land on the SAME ticket the server and KDS see (tagged QR). Light,
// consumer-friendly surface — the opposite of the dark ops screens.

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { BookingPanel } from './Guest/sections/BookingPanel.jsx'
import MenuConcierge from '../components/MenuConcierge'
import DishShowcase from '../components/three/DishShowcase'
import { Sheet } from '../components/ui'
import { QRCodeSVG } from 'qrcode.react'
import {
  translateCategory,
  translateDishName,
  translateModifier,
  translateTableName,
  useDomTranslator,
  useI18n,
} from '../lib/i18n'
import { isFreeTableStatus, isTableInServiceStatus } from '../lib/constants'
import { guestSessionToken, saveGuestOrder } from '../lib/guest-session'
import { money, orderTotals, uid } from '../lib/models'
import { categoryTree } from '../lib/settings'
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

// Friendly, guest-facing ticket states for the live status chip.
const TICKET_LABELS = {
  open: 'Seated',
  seated: 'Seated',
  occupied: 'Seated',
  ordered: 'Order received',
  sent: 'Order received',
  in_prep: 'Cooking',
  ready: 'Ready',
  served: 'Served',
  billing: 'Paying',
  billed: 'Paying',
  paid: 'Paid',
  void: 'Cancelled',
  cleaning: 'Being cleaned',
}

// Delivery-specific labels
const DELIVERY_TICKET_LABELS = {
  open: 'Order placed',
  sent: 'Confirmed',
  in_prep: 'Preparing',
  ready: 'Ready for pickup by rider',
  served: 'Out for delivery',
  paid: 'Delivered',
  void: 'Cancelled',
}

function openOrderFor(state, tableId) {
  return state.orders.find((o) => o.tableId === tableId && !['paid', 'void'].includes(o.status))
}

function paidOrderFor(state, tableId) {
  return state.orders
    .filter((o) => o.tableId === tableId && o.status === 'paid')
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0]
}

// ─── Small guest helpers ──────────────────────────────────────────

// Fixed-height photo box: an image that 404s used to `hidden` the <img> and
// collapse the card, shoving the whole menu up (CLS). Keep the box, swap in a
// skeleton while loading, and a calm placeholder if it never arrives.
function DishImage({ src, className }) {
  const [state, setState] = useState('loading')
  if (!src || state === 'error') {
    return (
      <div className={`${className} flex items-center justify-center overflow-hidden bg-stone-100 text-2xl opacity-40`} aria-hidden="true">
        🍽
      </div>
    )
  }
  return (
    <div className={`${className} relative overflow-hidden bg-stone-100`}>
      {state !== 'loaded' && <div className="absolute inset-0 animate-pulse bg-stone-200" aria-hidden="true" />}
      <img
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        className={`h-full w-full object-cover transition-opacity duration-300 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

// A phone loses signal mid-order; the guest deserves to know. Orders are
// online-only, so this warns instead of promising a later send.
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

// Its own component so the 4-minute "Server notified" window ticks without
// re-rendering the whole menu (see Wave 6.6).
function ServerCallControl({ tableId, serverCalledAt }) {
  const { dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const gu = dict.guest || {}
  const now = useNow(15000)
  const called = serverCalledAt ? now - new Date(serverCalledAt).getTime() < 4 * 60 * 1000 : false
  if (called) {
    return (
      <span
        className="flex min-h-[44px] items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700"
        role="status"
      >
        ✓ {gu.serverCalled || 'Server notified'}
        {lang !== 'en' && <span className="sr-only"> Server notified</span>}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'CALL_SERVER', tableId })}
      className="min-h-[44px] rounded-full border border-stone-200 bg-white px-4 text-sm font-bold text-stone-700 shadow-sm active:bg-stone-100"
    >
      🙋 {gu.callServer || 'Call server'}
      {lang !== 'en' && <span className="sr-only"> Call server</span>}
    </button>
  )
}

// Explicit order states — a guest should never have to guess what "in_prep"
// means. Four named steps (dine-in), five for delivery.
const ORDER_STEPS = ['Seated', 'Order received', 'Cooking', 'Ready']
const DELIVERY_STEPS = ['Order placed', 'Confirmed', 'Preparing', 'On the way', 'Delivered']
function orderStepIndex(order) {
  const status = order?.status || 'seated'
  if (['ordered', 'sent'].includes(status)) return 1
  if (['in_prep', 'preparing'].includes(status)) return 2
  if (['ready', 'served', 'billing', 'billed', 'paid'].includes(status)) return 3
  return 0
}
function deliveryStepIndex(order) {
  const status = order?.status || 'open'
  if (status === 'open') return 0
  if (['sent', 'ordered'].includes(status)) return 1
  if (['in_prep', 'preparing'].includes(status)) return 2
  if (status === 'served' || order?.deliveryStatus === 'out_for_delivery') return 3
  if (status === 'paid' || order?.deliveryStatus === 'delivered') return 4
  return 2
}
function OrderStatusStepper({ order, isDelivery = false }) {
  const steps = isDelivery ? DELIVERY_STEPS : ORDER_STEPS
  const current = isDelivery ? deliveryStepIndex(order) : orderStepIndex(order)
  return (
    <ol className="flex items-start gap-1" data-testid="guest-order-status" aria-label="Order status">
      {steps.map((label, i) => {
        const done = i <= current
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1 text-center">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${done ? 'bg-amber-500 text-stone-950' : 'bg-stone-200 text-stone-500'}`}
              aria-hidden="true"
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={`text-[10px] font-bold leading-tight ${done ? 'text-stone-600' : 'text-stone-400'}`}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
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
    <Sheet onClose={onClose} label={item.name}>
      {showImages && item.imageUrl && (
        <DishShowcase
          dish={item}
          className="mb-4 h-44 w-full rounded-2xl"
          photo={<DishImage src={item.imageUrl} className="h-full w-full" />}
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
    </Sheet>
  )
}

// ─── Pay sheet ────────────────────────────────────────────────────

function PaySheet({ order, onClose, onPaid }) {
  const { state, dispatch } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const t = orderTotals(order, menuById, state.settings.taxPct)
  const [tipPct, setTipPct] = useState(18)
  const [customTip, setCustomTip] = useState('')
  const [method, setMethod] = useState('apple_pay')
  const [processing, setProcessing] = useState(false)
  const tip = customTip !== '' ? Math.max(0, Number(customTip) || 0) : (t.subtotal * tipPct) / 100
  const finalTotal = Math.round((t.total + tip) * 100) / 100

  function handlePay() {
    if (processing) return
    setProcessing(true)
    setTimeout(() => {
      const tipRounded = Math.round(tip * 100) / 100
      dispatch({
        type: 'PAY_ORDER',
        orderId: order.id,
        method: method === 'apple_pay' ? 'card' : method,
        tip: tipRounded,
        split: { kind: 'full', by: 'guest' },
        freeTable: false,
        tenderDetails: {
          method,
          subtotal: t.subtotal,
          tax: t.tax,
          tip: tipRounded,
          total: finalTotal,
        },
      })
      setProcessing(false)
      onPaid()
    }, 350)
  }

  return (
    <Sheet onClose={onClose} label="Pay check">
      <h2 className="text-xl font-extrabold text-stone-900">Your check</h2>
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">
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
        {tip > 0 && (
          <div className="flex justify-between font-semibold text-amber-700">
            <span>Tip ({customTip ? 'Custom' : `${tipPct}%`})</span>
            <span className="tnum">+{money(tip)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black text-stone-900">
          <span>Total due</span>
          <span className="tnum text-amber-600">{money(finalTotal)}</span>
        </div>
      </div>

      <div className="mt-4 text-xs font-bold uppercase tracking-widest text-stone-500">Tip the team</div>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {[
          [0, 'No tip'],
          [10, '10%'],
          [15, '15%'],
          [18, '18%'],
          [20, '20%'],
        ].map(([p, label]) => {
          const active = customTip === '' && tipPct === p
          const amt = p > 0 ? (t.subtotal * p) / 100 : 0
          return (
            <button
              key={p}
              type="button"
              onClick={() => { setTipPct(p); setCustomTip('') }}
              className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-extrabold transition ${
                active ? 'bg-stone-900 text-white shadow-sm' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              <span>{label}</span>
              {p > 0 && <span className="tnum text-[10px] opacity-75">{money(amt)}</span>}
            </button>
          )
        })}
      </div>
      <input
        value={customTip}
        onChange={(e) => setCustomTip(e.target.value)}
        type="number"
        min="0"
        step="any"
        placeholder="Custom tip $"
        className="tnum mt-2 min-h-[40px] w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs"
      />

      <div className="mt-4 text-xs font-bold uppercase tracking-widest text-stone-500">Payment method</div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {[
          ['apple_pay', '🍎 Apple Pay'],
          ['card', '💳 Card'],
          ['qr', '📱 QR Pay'],
        ].map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`min-h-[42px] rounded-xl border text-xs font-extrabold transition ${
              method === m
                ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
                : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'qr' && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-amber-50/80 p-3 ring-1 ring-amber-200">
          <QRCodeSVG value={`restora:guest-pay?order=${order.id}&amount=${finalTotal}`} size={64} />
          <div className="text-xs text-stone-600">
            <div className="font-bold text-stone-900">Scan with your Banking App</div>
            <div>Supports KHQR, Bakong & PromptPay. Instant settlement.</div>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={processing}
        onClick={handlePay}
        className="tnum mt-4 min-h-[52px] w-full rounded-2xl bg-amber-500 text-base font-extrabold text-stone-950 shadow-sm hover:bg-amber-400 disabled:opacity-60"
      >
        {processing ? 'Authorizing payment...' : `Pay ${money(finalTotal)}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-stone-400">
        {state.settings?.operatingMode === 'production'
          ? '🔒 Secure checkout · Order verified'
          : 'Demo checkout · Simulated payment authorization'}
      </p>
    </Sheet>
  )
}

function PaidCheckSummary({ table, paid, menuById, taxPct, onResetTable }) {
  const t = paid ? orderTotals(paid, menuById, taxPct) : null
  const [rating, setRating] = useState(5)
  const [feedbackTags, setFeedbackTags] = useState([])
  const [showItemized, setShowItemized] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  const tags = ['🌟 Delicious food', '⚡ Super fast', '🍷 Great drinks', '🛋️ Cozy vibe', '👍 Friendly staff']

  function toggleTag(tag) {
    setFeedbackTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag])
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-600 shadow-inner">
          ✓
        </div>
        <h1 className="mt-3 text-2xl font-black text-stone-900">Payment Complete!</h1>
        <p className="mt-1 text-sm text-stone-500">
          {table?.name || 'Your order'} · check closed {paid?.paidAt ? new Date(paid.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Paid in full'}
        </p>
      </div>

      {t && (
        <div className="mt-5 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700">
          <div className="flex justify-between py-1">
            <span className="text-stone-500">Subtotal & Tax</span>
            <span className="tnum font-semibold">{money(t.total)}</span>
          </div>
          {(paid?.tip || 0) > 0 && (
            <div className="flex justify-between py-1 text-amber-800">
              <span className="font-medium">Staff Tip</span>
              <span className="tnum font-bold">+{money(paid.tip)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-base font-black text-stone-950">
            <span>Total Paid</span>
            <span className="tnum text-emerald-600">{money(t.total + (paid?.tip || 0))}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
            <span>Payment method:</span>
            <span className="font-bold capitalize">{paid?.payMethod === 'apple_pay' ? '🍎 Apple Pay' : paid?.payMethod === 'qr' ? '📱 Mobile QR' : '💳 Card'}</span>
          </div>
        </div>
      )}

      {t && t.lines.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowItemized((v) => !v)}
            className="flex w-full items-center justify-between py-2 text-xs font-bold text-stone-600 hover:text-stone-900"
          >
            <span>{showItemized ? 'Hide itemized receipt' : `View receipt details (${t.lines.length} items)`}</span>
            <span>{showItemized ? '▲' : '▼'}</span>
          </button>
          {showItemized && (
            <ul className="mt-1 space-y-1.5 rounded-2xl border border-stone-100 bg-stone-50/60 p-3 text-xs text-stone-600">
              {t.lines.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span>{l.qty}× {l.name}</span>
                  <span className="tnum font-semibold">{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-amber-200/60 bg-amber-50/50 p-4 text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-amber-900">How was your dining experience?</div>
        <div className="mt-2 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => { setRating(star); setFeedbackSent(true) }}
              className={`text-2xl transition hover:scale-125 ${star <= rating ? 'text-amber-500' : 'text-stone-300'}`}
              aria-label={`${star} star`}
            >
              ★
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => { toggleTag(tag); setFeedbackSent(true) }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                feedbackTags.includes(tag)
                  ? 'bg-amber-500 text-stone-950 shadow-sm'
                  : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        {feedbackSent && (
          <p className="mt-2 text-xs font-semibold text-emerald-700">
            Thank you! Your feedback has been shared with our team.
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3 rounded-2xl bg-stone-100/70 p-3">
        <QRCodeSVG value={typeof window !== 'undefined' ? window.location.href : 'https://restora.app'} size={54} />
        <div className="text-left text-xs text-stone-500">
          <div className="font-bold text-stone-700">Digital Copy Saved</div>
          <div>Scan to revisit or save your receipt.</div>
        </div>
      </div>

      {onResetTable && (
        <button
          type="button"
          onClick={onResetTable}
          className="mt-4 min-h-[46px] w-full rounded-2xl border border-stone-200 bg-white text-xs font-bold text-stone-600 hover:bg-stone-50"
        >
          Finished dining · Release table
        </button>
      )}
    </div>
  )
}

// ─── Guest app ────────────────────────────────────────────────────

// orderMode: 'dine_in' | 'pickup' | 'delivery'
export default function GuestScreen({
  tableId,
  allowPickup = false,
  onSelfSeat = null,
  initialOrderMode = null,
  embedded = false,
  defaultGuestName = '',
}) {
  const { state, dispatch, locId, link } = useRestora()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const gu = dict.guest || {}
  const { items: catalogMenu } = useMenuCatalog(state.menu, locId, link.status)
  const online = useOnline()
  const [tab, setTab] = useState('menu')
  const [cat, setCat] = useState('All')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [guestName, setGuestName] = useState(defaultGuestName)
  const [guestPhone, setGuestPhone] = useState('')
  const [detail, setDetail] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [justSent, setJustSent] = useState(false)
  // Order mode: pickup and delivery skip the table requirement.
  const [pickup, setPickup] = useState(() => initialOrderMode === 'pickup')
  const [delivery, setDelivery] = useState(() => initialOrderMode === 'delivery')
  const [pickupOrderId, setPickupOrderId] = useState(null)
  const [deliveryOrderId, setDeliveryOrderId] = useState(null)
  const [guestToken] = useState(() => guestSessionToken())
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [addressError, setAddressError] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [moveSubmitted, setMoveSubmitted] = useState(false)
  const [askOpen, setAskOpen] = useState(false)

  const table = state.tables.find((t) => t.id === tableId)
  const moveCandidates = useMemo(
    () => state.tables.filter((t) => t.id !== tableId && isFreeTableStatus(t.status)),
    [state.tables, tableId],
  )
  const pickupOrder = pickupOrderId
    ? state.orders.find((o) => o.id === pickupOrderId && !['paid', 'void'].includes(o.status))
    : null
  const pickupPaid = pickupOrderId
    ? state.orders.find((o) => o.id === pickupOrderId && o.status === 'paid')
    : null
  const deliveryOrder = deliveryOrderId
    ? state.orders.find((o) => o.id === deliveryOrderId && !['paid', 'void'].includes(o.status))
    : null
  const order = delivery ? deliveryOrder : pickup ? pickupOrder : (table ? openOrderFor(state, tableId) : null)
  const paid = !pickup && !delivery && table ? paidOrderFor(state, tableId) : null
  const menuById = useMemo(() => Object.fromEntries(catalogMenu.map((m) => [m.id, m])), [catalogMenu])
  const activeMenu = useMemo(() => catalogMenu.filter((m) => m.active !== false), [catalogMenu])
  const menuTree = useMemo(() => categoryTree(state.categories, 'menu'), [state.categories])
  const distinctCats = useMemo(() => [...new Set(activeMenu.map((m) => m.category))], [activeMenu])
  const cats = useMemo(() => {
    const fromTree = menuTree.map((root) => root.name)
    return ['All', ...new Set([...fromTree, ...distinctCats])]
  }, [menuTree, distinctCats])
  const needle = query.trim().toLowerCase()
  const available = useMemo(() => activeMenu.filter((m) => {
    if (!m.available) return false
    if (cat !== 'All' && m.category !== cat) return false
    if (!needle) return true
    const hay = [m.name, m.description, m.category, translateDishName(m, lang)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  }), [activeMenu, cat, needle, lang])

  // One flat section per category — no nested accordions, no sticky
  // sub-headers fighting the Telegram chrome. Search and the category rail
  // are the only navigation.
  const menuSections = useMemo(() => {
    const groups = new Map()
    for (const m of available) {
      const key = m.category || 'Other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(m)
    }
    const order = [...menuTree.map((root) => root.name), ...distinctCats]
    const rank = (name) => {
      const index = order.indexOf(name)
      return index === -1 ? 999 : index
    }
    return [...groups.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([name, dishes]) => ({ name, dishes }))
  }, [available, menuTree, distinctCats])

  const myLines = order ? order.items.filter((i) => i.by === 'guest' && !i.voided) : []
  const firingCount = myLines.filter((line) => line.status === 'fired').length
  const cartTotal = cart.reduce((s, c) => s + (menuById[c.menuItemId]?.price || 0) * c.qty, 0)
  const cartCount = cart.reduce((s, c) => s + c.qty, 0)

  function addToCart(menuItem, extra) {
    setCart((c) => [...c, {
      key: `${menuItem.id}-${Date.now()}-${c.length}`,
      menuItemId: menuItem.id, course: courseFor(menuItem), ...extra,
    }])
    setDetail(null)
  }

  // Simple dishes go straight in; required modifiers still open the sheet.
  function quickAdd(menuItem) {
    if ((menuItem.modifiers || []).some((group) => group.required)) {
      setDetail(menuItem)
      return
    }
    addToCart(menuItem, { qty: 1, modifiers: [] })
  }

  function changeQty(key, delta) {
    setCart((list) => list
      .map((line) => (line.key === key
        ? { ...line, qty: Math.max(0, Math.min(12, line.qty + delta)) }
        : line))
      .filter((line) => line.qty > 0))
  }

  function sendCart() {
    if (!cart.length) return
    const name = guestName.trim()
    const phone = guestPhone.trim()
    if (delivery || pickup) {
      if (!name) { setNameError(true); return }
      setNameError(false)
    }
    if (delivery) {
      const addr = deliveryAddress.trim()
      if (!addr) { setAddressError(true); return }
      setAddressError(false)
      // Single atomic action — creates the delivery order + fires lines.
      // The client id travels with the action so tracking can find the
      // order the reducer actually created.
      const orderId = uid('o')
      setDeliveryOrderId(orderId)
      saveGuestOrder({ orderId, type: 'delivery', guestToken, at: Date.now() })
      dispatch({
        type: 'GUEST_SEND',
        orderType: 'delivery',
        orderId,
        guestToken,
        customer: { name, phone },
        deliveryAddress: deliveryAddress.trim(),
        items: cart.map((c) => ({ ...c, guest: name })),
      })
    } else if (pickup) {
      // One takeout ticket per guest session: create it once, then append.
      const orderId = pickupOrderId || uid('o')
      if (!pickupOrderId) {
        setPickupOrderId(orderId)
        saveGuestOrder({ orderId, type: 'takeout', guestToken, at: Date.now() })
        dispatch({
          type: 'GUEST_SEND',
          orderType: 'takeout',
          orderId,
          guestToken,
          customer: { name, phone },
          items: cart.map((c) => ({ ...c, guest: name })),
        })
      } else {
        for (const c of cart) {
          dispatch({ type: 'ADD_ITEM', orderId, menuItemId: c.menuItemId, qty: c.qty, modifiers: c.modifiers, course: c.course, notes: c.notes, by: 'guest', guest: name })
        }
        dispatch({ type: 'SEND_ORDER', orderId })
      }
    } else {
      dispatch({
        type: 'GUEST_SEND',
        tableId,
        items: cart.map((c) => ({ ...c, guest: name || null })),
      })
    }
    setCart([])
    setCartOpen(false)
    setJustSent(true)
    setTab('orders')
    window.setTimeout(() => setJustSent(false), 5000)
    // The Telegram mini app listens for this to fire a haptic tap.
    window.dispatchEvent(new CustomEvent('restora:order-sent', { detail: { tableId: tableId || null, orderType: delivery ? 'delivery' : pickup ? 'takeout' : 'dine_in' } }))
  }

  // Photo policy lives in Settings → Food & menu so a slow connection can
  // keep the guest page lean.
  const guestPhotos = state.settings?.food?.imagesOnGuestMenu !== false

  const shell = (inner) => (
    <div className="min-h-screen bg-[var(--guest-bg)] text-stone-900">
      <div className="mx-auto max-w-md px-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-6">{inner}</div>
    </div>
  )

  if (!pickup && !delivery && !table) {
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🧾</div>
        <h1 className="mt-3 text-xl font-extrabold">Hmm, that code didn&apos;t scan.</h1>
        <p className="mt-1 text-sm text-stone-500">Try the tent card on your table again, or ask your server.</p>
        {allowPickup && (
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => setPickup(true)}
              className="min-h-[48px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white"
            >
              {gu.orderForPickup || '🍽 Order for pickup'}
            </button>
            <button
              type="button"
              onClick={() => setDelivery(true)}
              className="min-h-[48px] w-full rounded-2xl bg-amber-500 text-sm font-extrabold text-stone-950"
            >
              🛵 {gu.orderForDelivery || 'Order for delivery'}
            </button>
          </div>
        )}
      </div>,
    )
  }

  if (!pickup && (table.status === 'billed' || (paid && !order))) {
    return shell(
      <PaidCheckSummary
        table={table}
        paid={paid}
        menuById={menuById}
        taxPct={state.settings.taxPct}
        onResetTable={() => dispatch({ type: 'BUS_TABLE', tableId: table.id })}
      />,
    )
  }

  // A guest who self-seated from the mini app gets status 'occupied', a
  // guest waiting on the check gets 'billing' — both are dining, not
  // "not seated yet".
  if (!pickup && !delivery && !isTableInServiceStatus(table.status)) {
    const openTables = state.tables.filter((t) => t.status === 'seated' || t.status === 'ordered')
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🪑</div>
        <h1 className="mt-3 text-xl font-extrabold">{translateTableName(table.name, lang)}{lang === 'km' ? ' មិនទាន់បានដាក់ភ្ញៀវអង្គុយទេ។' : lang === 'zh' ? ' 尚未入座。' : " isn't seated yet."}{lang !== 'en' && <span className="sr-only"> {table.name} isn&apos;t seated yet.</span>}</h1>
        <p className="mt-1 text-sm text-stone-500">{lang === 'km' ? 'បុគ្គលិកទទួលភ្ញៀវនឹងដាក់លោកអ្នកអង្គុយ បន្ទាប់មកមុខម្ហូបនេះនឹងបើក។ ការរង់ចាំគឺមានតម្លៃ។' : lang === 'zh' ? '接待员安排入座后，菜单即会解锁。等待是值得的。' : 'Your host will seat you, then this menu unlocks. The wait is worth it.'}</p>
        {(allowPickup || onSelfSeat) && (
          <div className="mt-5 space-y-3">
            {onSelfSeat && (
              <button
                type="button"
                onClick={onSelfSeat}
                className="min-h-[48px] w-full rounded-2xl bg-amber-500 text-sm font-extrabold text-stone-950 hover:bg-amber-400"
              >
                🪑 Sit at {translateTableName(table.name, lang)}
              </button>
            )}
            {allowPickup && (
              <button
                type="button"
                onClick={() => setPickup(true)}
                className="min-h-[48px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white"
              >
                {gu.orderForPickup || '🍽 Order for pickup'}
              </button>
            )}
            {allowPickup && (
              <button
                type="button"
                onClick={() => setDelivery(true)}
                className="min-h-[48px] w-full rounded-2xl border border-stone-200 bg-white text-sm font-extrabold text-stone-800"
              >
                🛵 {gu.orderForDelivery || 'Order for delivery'}
              </button>
            )}
            {allowPickup && (
              <p className="text-[11px] leading-relaxed text-stone-400">
                {openTables.length
                  ? 'Or tap a free table above to sit down.'
                  : 'No tables are free right now — you can still order for pickup or delivery.'}
              </p>
            )}
          </div>
        )}
      </div>,
    )
  }

  // ── Delivery paid / in-flight completion screen ─────────────────
  if (delivery && deliveryOrderId) {
    const liveDelivery = state.orders.find((o) => o.id === deliveryOrderId)
    if (liveDelivery) {
      const isPaid = liveDelivery.status === 'paid'
      const isOut = liveDelivery.deliveryStatus === 'out_for_delivery' || liveDelivery.status === 'served'
      return shell(
        <div className="space-y-4">
          <div className="rounded-3xl bg-white p-6 shadow-sm text-center">
            <div className="text-4xl">{isPaid ? '✅' : isOut ? '🛵' : '📦'}</div>
            <h1 className="mt-3 text-xl font-extrabold text-stone-900">
              {isPaid ? 'Order delivered!' : isOut ? 'On the way!' : 'Order confirmed!'}
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              {isPaid
                ? 'Thank you — enjoy your meal.'
                : isOut
                  ? 'Your rider is heading to you now.'
                  : 'We\'re preparing your order. Hang tight!'}
            </p>
            {liveDelivery.deliveryAddress && (
              <p className="mt-2 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                📍 Delivering to: <strong>{liveDelivery.deliveryAddress}</strong>
              </p>
            )}
          </div>
          <div className="rounded-3xl bg-white p-4 shadow-sm">
            <OrderStatusStepper order={liveDelivery} isDelivery />
          </div>
          {!isPaid && (
            <button
              type="button"
              onClick={() => { setDeliveryOrderId(null); setDelivery(true); setTab('menu') }}
              className="min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white text-xs font-bold text-stone-500"
            >
              Start a new delivery order
            </button>
          )}
        </div>,
      )
    }
  }

  if (pickup && !pickupOrder && pickupPaid) {
    const t = orderTotals(pickupPaid, menuById, state.settings.taxPct)
    return shell(
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🎉</div>
        <h1 className="mt-3 text-xl font-extrabold">Thanks — your order is in!</h1>
        <p className="mt-1 text-sm text-stone-500">We&apos;ll call your name when it&apos;s ready for pickup.</p>
        <div className="tnum mt-4 rounded-2xl bg-stone-50 p-4 text-sm">
          <div className="flex justify-between"><span>Total paid</span><strong>{money(t.total + (pickupPaid.tip || 0))}</strong></div>
        </div>
        <button
          type="button"
          onClick={() => { setPickupOrderId(null); setTab('menu'); setPickup(true) }}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white"
        >
          Start another order
        </button>
      </div>,
    )
  }

  const heldAny = order ? order.items.some((i) => i.status === 'held' && !i.voided) : false
  const payable = order && ['sent', 'in_prep', 'ready', 'served'].includes(order.status) && !heldAny
  const bill = order ? orderTotals(order, menuById, state.settings.taxPct) : null
  const heading = delivery
    ? (gu.deliveryOrder || '🛵 Delivery order')
    : pickup
      ? (gu.pickupOrder || 'Pickup order')
      : translateTableName(table?.name, lang)
  // Live, guest-facing status chip.
  const liveStatus = (() => {
    if (delivery) return deliveryOrder ? (DELIVERY_TICKET_LABELS[deliveryOrder.status] || 'Order placed') : null
    if (pickup) return pickupPaid ? 'Paid' : pickupOrder ? (TICKET_LABELS[pickupOrder.status] || 'Order placed') : null
    if (order) return TICKET_LABELS[order.status] || 'Seated'
    if (paid) return 'Paid'
    if (table && isTableInServiceStatus(table.status)) return TICKET_LABELS[table.status] || 'Seated'
    return null
  })()

  return (
    <div className="min-h-screen bg-[var(--guest-bg)] text-stone-900">
      <div className="mx-auto max-w-md px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5">
        {!online && (
          <div className="mb-3 rounded-2xl bg-stone-800 px-4 py-2.5 text-xs font-semibold text-white shadow-sm" role="status" data-testid="guest-offline">
            You&apos;re offline — reconnect to send your order.
          </div>
        )}
        {/* Embedded in the mini app, the Telegram chrome already carries the
            restaurant, table, language and service actions. Rendering a second
            header here was the biggest source of vertical noise. */}
        {!embedded && (
          <header className="mb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">
                  {delivery
                    ? (gu.deliveryEyebrow || 'Restora · delivery order')
                    : pickup
                      ? (gu.pickupEyebrow || 'Restora · order for pickup')
                      : (gu.orderAtTable || 'Restora · order at table')}
                  {lang !== 'en' && <span className="sr-only"> {delivery ? 'Restora · delivery order' : pickup ? 'Restora · order for pickup' : 'Restora · order at table'}</span>}
                </div>
                <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">
                  {heading}
                  {!pickup && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
                </h1>
                {liveStatus && (
                  <span
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-800"
                    role="status"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    {liveStatus}
                    {lang !== 'en' && <span className="sr-only"> {liveStatus}</span>}
                  </span>
                )}
              </div>
              <LanguageSwitcher compact testIdPrefix="guest-lang" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAskOpen(true)}
                data-testid="guest-ask-menu"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--guest-accent)] px-3.5 text-xs font-bold text-[var(--guest-ink)] shadow-sm active:brightness-95"
              >
                <Icon name="sparkles" size={15} /> {lang === 'km' ? 'សួរម្ហូប' : lang === 'zh' ? '咨询菜单' : 'Menu help'}
                {lang !== 'en' && <span className="sr-only"> Ask about the menu</span>}
              </button>
              {!pickup && !delivery && (
                <button
                  type="button"
                  onClick={() => setMoveModalOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 text-xs font-bold text-stone-700 shadow-sm active:bg-stone-100"
                >
                  <Icon name="swap" size={15} /> {dict.common?.transferTable || 'Move'}
                </button>
              )}
              {!pickup && !delivery && <ServerCallControl tableId={tableId} serverCalledAt={table?.serverCalledAt} />}
            </div>
          </header>
        )}

        {table?.pendingTransfer && table.pendingTransfer.status === 'pending' && (
          <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 shadow-sm" role="status">
            <div className="font-bold flex items-center gap-1.5">
              <span>🔄</span> {dict.common?.pendingMove || 'Table move requested'}: {table.name} ➔ {table.pendingTransfer.targetTableName || `Table #${table.pendingTransfer.targetTableId}`}
            </div>
            <div className="mt-1 text-stone-600">
              Floor staff has been notified and will come guide you once your table is ready.
            </div>
          </div>
        )}
        {moveSubmitted && (
          <div className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-bold text-emerald-900 shadow-sm" role="status">
            ✓ Request sent to floor staff!
          </div>
        )}

        {justSent && (
          <div className="mt-3 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow" role="status">
            {gu.sentToKitchen || 'Sent to the kitchen — watch it here live. 🔥'}
          </div>
        )}

        {tab === 'menu' && (
          <>
            <div className="mt-4 flex items-center gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Search dishes</span>
                <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search dishes"
                  className="min-h-[46px] w-full rounded-2xl border border-stone-200/80 bg-white pl-10 pr-9 text-sm shadow-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-lg text-stone-400"
                  >
                    ×
                  </button>
                )}
              </label>
              <button
                type="button"
                onClick={() => setAskOpen(true)}
                data-testid="guest-ask-menu"
                aria-label="Ask about the menu"
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-[var(--guest-accent)] text-[var(--guest-ink)] shadow-sm"
              >
                <Icon name="sparkles" size={18} />
              </button>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {cats.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-bold transition-colors ${
                    cat === c
                      ? 'bg-stone-900 text-white shadow-sm'
                      : 'bg-white text-stone-600 ring-1 ring-stone-200/70'
                  }`}
                >
                  {c === 'All' ? 'All' : translateCategory(c, lang)}
                  {lang !== 'en' && <span className="sr-only"> {c}</span>}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-7">
              {menuSections.map(({ name, dishes }) => (
                <section key={name} className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-base font-extrabold tracking-tight text-stone-900">{translateCategory(name, lang)}</h2>
                    <span className="text-[11px] font-bold text-stone-400">{dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {dishes.map((m) => (
                      <article key={m.id} className="relative overflow-hidden rounded-[22px] bg-white shadow-sm ring-1 ring-black/[0.03]">
                        <button type="button" onClick={() => setDetail(m)} className="block w-full text-left">
                          {guestPhotos && m.imageUrl ? (
                            <DishImage src={m.imageUrl} className="h-28 w-full" />
                          ) : (
                            <div className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-amber-50 to-stone-100 text-2xl" aria-hidden="true">🍽</div>
                          )}
                          <div className="p-3 pb-10">
                            <h3 className="line-clamp-2 text-[13px] font-extrabold leading-snug text-stone-900">
                              {translateDishName(m, lang)}
                              {lang !== 'en' && <span className="sr-only"> {m.name}</span>}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-500">
                              {m.description || DESC[m.id] || 'Prepared fresh to order.'}
                            </p>
                            {!!m.dietaryTags?.length && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {m.dietaryTags.slice(0, 2).map((tag) => (
                                  <span key={tag} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                          <span className="tnum text-sm font-extrabold text-amber-700">{money(m.price)}</span>
                          <button
                            type="button"
                            onClick={() => quickAdd(m)}
                            aria-label={`Add ${m.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--guest-accent)] text-[var(--guest-ink)] shadow-sm transition-transform active:scale-95"
                          >
                            <Icon name="plus" size={17} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}

              {available.length === 0 && (
                <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
                  <div className="text-2xl" aria-hidden="true">🍽</div>
                  <p className="mt-2 text-sm font-semibold text-stone-700">
                    {needle ? 'No dishes match your search.' : 'Nothing available in this category right now.'}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {needle ? 'Try another word or browse a category.' : 'The kitchen is restocking — try another craving.'}
                  </p>
                  {needle && (
                    <button type="button" onClick={() => setQuery('')} className="mt-3 min-h-[40px] rounded-full bg-stone-100 px-4 text-xs font-bold text-stone-700">
                      Clear search
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="mt-4 text-center text-[11px] text-stone-400">
              Sold-out dishes disappear instantly.
            </p>
          </>
        )}

        {tab === 'orders' && (
          <div className="mt-4 space-y-3" data-testid="guest-orders">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-stone-500">
                {pickup ? 'Pickup order' : delivery ? 'Delivery order' : 'Your table'}
              </h2>
              {liveStatus && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  {liveStatus}
                </span>
              )}
            </div>

            {(!order || !order.items?.length) && (
              <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
                <div className="text-3xl" aria-hidden="true">🍽</div>
                <p className="mt-2 text-sm font-semibold text-stone-700">Nothing sent yet</p>
                <p className="mt-1 text-xs leading-relaxed text-stone-500">
                  Add a dish and send it to the kitchen — it appears here live.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('menu')}
                  className="mt-3 min-h-[44px] rounded-full bg-stone-900 px-5 text-xs font-bold text-white"
                >
                  Browse the menu
                </button>
              </div>
            )}

            {order && (
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <OrderStatusStepper order={order} isDelivery={delivery} />
              </div>
            )}

            {myLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-3xl bg-white p-4 shadow-sm">
                <div className="min-w-0">
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

            {order && bill && bill.lines.length > 0 && (
              <>
                <div className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-stone-900">
                      {pickup || delivery ? 'Order summary' : 'Table check'}
                    </h3>
                    <span className="text-[11px] font-semibold text-stone-400">{bill.lines.length} lines</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {bill.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3 text-stone-700">
                        <span className="min-w-0">
                          {l.qty}× {translateDishName(menuById[l.menuItemId] || { id: l.menuItemId, name: l.name }, lang)}
                          {l.by !== 'guest' && <span className="text-stone-400"> (server)</span>}
                        </span>
                        <span className="tnum shrink-0 font-bold">{money(l.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
                    <div className="flex justify-between text-stone-500"><span>Subtotal</span><span className="tnum">{money(bill.subtotal)}</span></div>
                    {bill.delivery > 0 && (
                      <div className="flex justify-between text-stone-500"><span>Delivery fee</span><span className="tnum">{money(bill.delivery)}</span></div>
                    )}
                    <div className="flex justify-between text-stone-500"><span>Tax</span><span className="tnum">{money(bill.tax)}</span></div>
                    <div className="flex justify-between border-t border-stone-100 pt-1.5 text-base font-extrabold"><span>Total</span><span className="tnum">{money(bill.total)}</span></div>
                  </div>
                </div>

                {payable ? (
                  <button
                    type="button"
                    onClick={() => setPayOpen(true)}
                    className="tnum min-h-[52px] w-full rounded-2xl bg-stone-900 text-base font-extrabold text-white shadow-sm"
                  >
                    Pay {money(bill.total)}
                  </button>
                ) : (
                  <div className="rounded-3xl bg-white p-4 text-center text-sm text-stone-500 shadow-sm">
                    {order.status === 'open' || heldAny
                      ? 'Your server is still adding items — payment unlocks when everything is in.'
                      : 'The check is closing — one moment.'}
                  </div>
                )}
              </>
            )}

            {order && order.billRequested && (
              <div className="rounded-3xl bg-violet-600 p-4 text-center text-sm font-bold text-white shadow">
                Your server is on the way with the card reader. 💳
              </div>
            )}

            {order && !pickup && !delivery && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'REQUEST_BILL', orderId: order.id })}
                disabled={!!order.billRequested}
                className="min-h-[48px] w-full rounded-2xl border border-stone-200 bg-white text-sm font-bold text-stone-600 disabled:opacity-50"
              >
                {order.billRequested ? 'Server notified ✓' : 'Ask server to take payment instead'}
              </button>
            )}
          </div>
        )}

        {tab === 'book' && <BookingPanel defaultName={guestName || defaultGuestName} />}

        {/* Bottom nav + cart bar */}
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md bg-white/95 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur" aria-label="Guest navigation">
          {cartCount > 0 && (
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="tnum mb-2 flex min-h-[54px] w-full items-center justify-between gap-3 rounded-2xl bg-[var(--guest-accent)] px-4 text-sm font-extrabold text-[var(--guest-ink)] shadow-sm"
            >
              <span className="flex items-center gap-2">
                <Icon name="cart" size={18} />
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </span>
              <span className="flex items-center gap-1.5">
                {money(cartTotal)}
                <span className="font-bold opacity-60">· Review →</span>
              </span>
            </button>
          )}
          <div className="grid grid-cols-3 gap-1" aria-label="Guest sections">
            {[
              ['menu', 'Menu', 'menu'],
              ['orders', firingCount ? `Orders · ${firingCount}` : 'Orders', 'orders'],
              ['book', 'Book', 'calendar'],
            ].map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition-colors ${
                  tab === id ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-500'
                }`}
              >
                <Icon name={icon} size={18} />
                {label}
              </button>
            ))}
          </div>
        </nav>

        {detail && (
          <DishModal item={detail} showImages={guestPhotos} onClose={() => setDetail(null)} onAdd={(extra) => addToCart(detail, extra)} />
        )}

        {cartOpen && (
          <Sheet onClose={() => setCartOpen(false)} label="Your order" tall>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
                  {delivery ? 'Delivery' : pickup ? 'Pickup' : heading}
                </p>
                <h2 className="mt-0.5 text-xl font-extrabold text-stone-900">Review your order</h2>
              </div>
              <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </span>
            </div>

            <ul className="mt-4 space-y-2.5">
              {cart.map((c) => {
                const dish = menuById[c.menuItemId]
                return (
                  <li key={c.key} className="rounded-2xl bg-stone-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-stone-900">
                          {dish ? translateDishName(dish, lang) : c.menuItemId}
                          {lang !== 'en' && dish && <span className="sr-only"> {dish.name}</span>}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-stone-500">
                          {(c.modifiers || []).map((m) => translateModifier(m.value, lang)).join(' · ')}
                          {c.notes ? `${(c.modifiers || []).length ? ' · ' : ''}“${c.notes}”` : ''}
                        </div>
                      </div>
                      <span className="tnum shrink-0 text-sm font-extrabold text-stone-900">
                        {money((dish?.price || 0) * c.qty)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="inline-flex items-center rounded-full bg-white ring-1 ring-stone-200">
                        <button
                          type="button"
                          aria-label={`Decrease ${dish?.name || 'item'}`}
                          onClick={() => changeQty(c.key, -1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-stone-600 active:bg-stone-100"
                        >
                          −
                        </button>
                        <span className="tnum w-7 text-center text-sm font-extrabold">{c.qty}</span>
                        <button
                          type="button"
                          aria-label={`Increase ${dish?.name || 'item'}`}
                          onClick={() => changeQty(c.key, 1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-stone-600 active:bg-stone-100"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => changeQty(c.key, -c.qty)}
                        className="min-h-[40px] px-2 text-xs font-bold text-stone-400"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="mt-5 space-y-2.5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Your details</h3>
                <span className="text-[10px] font-semibold text-stone-400">
                  {pickup || delivery ? 'Required' : 'Optional'}
                </span>
              </div>
              <input
                value={guestName}
                onChange={(event) => { setGuestName(event.target.value); setNameError(false) }}
                maxLength={24}
                aria-label="Your name"
                autoComplete="name"
                placeholder={delivery
                  ? 'Your name — required for delivery'
                  : pickup
                    ? 'Your name — we’ll call it when your order is ready'
                    : 'Your name (optional — helps the kitchen)'}
                className={`min-h-[46px] w-full rounded-2xl border bg-white px-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-200 ${nameError ? 'border-red-400 ring-2 ring-red-200' : 'border-stone-200'}`}
              />
              {nameError && (
                <p className="text-xs font-semibold text-red-600" role="alert">
                  {delivery ? 'Your name is required for delivery.' : 'Add your name so we can call your order.'}
                </p>
              )}
              {(pickup || delivery) && (
                <input
                  value={guestPhone}
                  onChange={(event) => setGuestPhone(event.target.value)}
                  maxLength={30}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Phone number"
                  placeholder="Phone number (optional — for order updates)"
                  className="min-h-[46px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-200"
                />
              )}
              {delivery && (
                <>
                  <input
                    value={deliveryAddress}
                    onChange={(event) => { setDeliveryAddress(event.target.value); setAddressError(false) }}
                    maxLength={120}
                    aria-label="Delivery address"
                    autoComplete="street-address"
                    placeholder="Delivery address — street, building, apt…"
                    className={`min-h-[46px] w-full rounded-2xl border bg-white px-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-200 ${addressError ? 'border-red-400 ring-2 ring-red-200' : 'border-stone-200'}`}
                  />
                  {addressError && (
                    <p className="text-xs font-semibold text-red-600" role="alert">
                      Please enter a delivery address.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm">
              <div className="flex justify-between font-bold text-stone-900">
                <span>Subtotal</span>
                <span className="tnum">{money(cartTotal)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-stone-400">
                {delivery
                  ? 'Delivery fee and tax are confirmed when you place the order.'
                  : 'Tax is added to the final bill.'}
              </p>
            </div>

            <button
              type="button"
              onClick={sendCart}
              disabled={!cart.length}
              className="tnum mt-4 min-h-[52px] w-full rounded-2xl bg-[var(--guest-accent)] text-base font-extrabold text-[var(--guest-ink)] shadow-sm disabled:opacity-40"
            >
              {delivery ? 'Place delivery order' : pickup ? 'Place pickup order' : 'Send to kitchen'} · {money(cartTotal)}
            </button>
            <p className="mt-2 text-center text-[11px] leading-relaxed text-stone-400">
              {delivery
                ? 'Your order goes straight to the kitchen — a rider is dispatched when it is ready.'
                : pickup
                  ? 'We will call your name when your order is ready.'
                  : 'Fires straight to the kitchen — the same as your server sending it.'}
            </p>
          </Sheet>
        )}

        {payOpen && order && (
          <PaySheet order={order} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); setTab('orders') }} />
        )}

        {moveModalOpen && (
          <Sheet title={`🔄 ${dict.common?.transferTable || 'Request Table Move'}`} onClose={() => setMoveModalOpen(false)}>
              <p className="text-xs text-stone-500">
                Want a different spot? Choose an open table and our floor staff will assist you with moving.
              </p>
              {moveCandidates.length === 0 ? (
                <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs text-amber-900">
                  All other tables are currently occupied or being cleaned. Please speak with your server for assistance.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-bold text-stone-700">
                    Select available table:
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {moveCandidates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMoveTargetId(t.id)}
                        className={`rounded-2xl border p-3 text-left transition ${
                          (moveTargetId || moveCandidates[0]?.id) === t.id
                            ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30'
                            : 'border-stone-200 bg-white hover:border-stone-300'
                        }`}
                      >
                        <div className="font-bold text-stone-900">{translateTableName(t.name, lang)}</div>
                        <div className="text-[11px] text-stone-500">{t.seats} seats · {t.zone}</div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Reason (optional):
                    </label>
                    <input
                      value={moveReason}
                      onChange={(e) => setMoveReason(e.target.value)}
                      placeholder="e.g. Near window, AC draft, quieter"
                      className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2 text-xs text-stone-800"
                      maxLength={60}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const chosen = moveTargetId || moveCandidates[0]?.id
                      if (!chosen) return
                      dispatch({
                        type: 'REQUEST_TABLE_TRANSFER',
                        payload: {
                          currentTableId: tableId,
                          targetTableId: chosen,
                          reason: moveReason.trim() || 'Guest requested move',
                          sessionToken: table?.sessionToken,
                        },
                      })
                      setMoveModalOpen(false)
                      setMoveSubmitted(true)
                      window.setTimeout(() => setMoveSubmitted(false), 6000)
                    }}
                    className="mt-2 min-h-[48px] w-full rounded-2xl bg-amber-500 text-sm font-extrabold text-stone-950 hover:bg-amber-400"
                  >
                    Send Move Request
                  </button>
                </div>
              )}
          </Sheet>
        )}

        {askOpen && <MenuConcierge lang={lang} locId={locId} onClose={() => setAskOpen(false)} />}
      </div>
    </div>
  )
}
