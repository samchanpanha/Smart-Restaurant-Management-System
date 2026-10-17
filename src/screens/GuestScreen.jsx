// ─── Guest QR ordering ────────────────────────────────────────────
// Scan the table tent → menu → send → live status → pay. Guest lines
// land on the SAME ticket the server and KDS see (tagged QR). Light,
// consumer-friendly surface — the opposite of the dark ops screens.

import { useEffect, useMemo, useState } from 'react'
import LanguageSwitcher from '../components/LanguageSwitcher'
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
export default function GuestScreen({ tableId, allowPickup = false, onSelfSeat = null, initialOrderMode = null }) {
  const { state, dispatch, locId, link } = useRestora()
  const { lang, dict } = useI18n()
  useDomTranslator(null, lang)
  const gu = dict.guest || {}
  const { items: catalogMenu } = useMenuCatalog(state.menu, locId, link.status)
  const online = useOnline()
  const [tab, setTab] = useState('menu')
  const [cat, setCat] = useState('Mains')
  const [cart, setCart] = useState([])
  const [guestName, setGuestName] = useState('')
  const [detail, setDetail] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [justSent, setJustSent] = useState(false)
  // Order mode: pickup and delivery skip the table requirement.
  const [pickup, setPickup] = useState(() => initialOrderMode === 'pickup')
  const [delivery, setDelivery] = useState(() => initialOrderMode === 'delivery')
  const [pickupOrderId, setPickupOrderId] = useState(null)
  const [deliveryOrderId, setDeliveryOrderId] = useState(null)
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
  const available = activeMenu.filter((m) => m.available && (m.category === cat || cat === 'All'))
  const [collapsedSubs, setCollapsedSubs] = useState({})

  function toggleSubCollapse(subId) {
    setCollapsedSubs((cur) => ({ ...cur, [subId]: !cur[subId] }))
  }

  const categorizedSections = useMemo(() => {
    const targetRoots = cat === 'All'
      ? (menuTree.length > 0 ? menuTree : distinctCats.map((name) => ({ id: `cat_${name}`, name, children: [] })))
      : (menuTree.filter((root) => root.name.toLowerCase() === cat.toLowerCase()).length > 0
          ? menuTree.filter((root) => root.name.toLowerCase() === cat.toLowerCase())
          : [{ id: `cat_${cat}`, name: cat, children: [] }])

    const matchedIds = new Set()
    const sections = targetRoots.map((root) => {
      const subGroups = (root.children || []).map((child) => {
        const dishes = available.filter((m) => {
          const matchesCat = m.category?.toLowerCase() === root.name.toLowerCase()
          const matchesSub = m.subCategory?.toLowerCase() === child.name.toLowerCase()
          return (matchesCat && matchesSub) || (!m.subCategory && m.category?.toLowerCase() === child.name.toLowerCase())
        })
        dishes.forEach((d) => matchedIds.add(d.id))
        return { child, dishes }
      })

      const directDishes = available.filter((m) => {
        if (matchedIds.has(m.id)) return false
        return m.category?.toLowerCase() === root.name.toLowerCase()
      })
      directDishes.forEach((d) => matchedIds.add(d.id))

      const totalCount = directDishes.length + subGroups.reduce((sum, sg) => sum + sg.dishes.length, 0)
      return {
        root,
        directDishes,
        subGroups,
        totalCount,
      }
    })

    const remainingDishes = available.filter((m) => !matchedIds.has(m.id))
    if (remainingDishes.length > 0 && (cat === 'All' || remainingDishes.some((m) => m.category?.toLowerCase() === cat.toLowerCase()))) {
      const extraByCat = new Map()
      for (const d of remainingDishes) {
        if (cat !== 'All' && d.category?.toLowerCase() !== cat.toLowerCase()) continue
        const cName = d.category || 'Other'
        if (!extraByCat.has(cName)) extraByCat.set(cName, [])
        extraByCat.get(cName).push(d)
      }
      for (const [cName, dishes] of extraByCat.entries()) {
        sections.push({
          root: { id: `orphan_${cName}`, name: cName, color: '#f59e0b', children: [] },
          directDishes: dishes,
          subGroups: [],
          totalCount: dishes.length,
        })
      }
    }

    return sections
  }, [available, cat, distinctCats, menuTree])

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
    const name = guestName.trim()
    if (delivery) {
      // Delivery: name required, address required.
      if (!name) { setNameError(true); setCartOpen(false); return }
      const addr = deliveryAddress.trim()
      if (!addr) { setAddressError(true); setCartOpen(false); return }
      // Single atomic action — creates the delivery order + fires lines.
      const orderId = uid('o')
      setDeliveryOrderId(orderId)
      dispatch({
        type: 'GUEST_SEND',
        orderType: 'delivery',
        customer: { name },
        deliveryAddress: addr,
        items: cart.map((c) => ({ ...c, guest: name })),
      })
    } else if (pickup) {
      if (!name) { setNameError(true); setCartOpen(false); return }
      // One takeout ticket per guest session: create it once, then append.
      const orderId = pickupOrderId || uid('o')
      if (!pickupOrderId) {
        setPickupOrderId(orderId)
        dispatch({ type: 'GUEST_SEND', orderType: 'takeout', customer: { name }, items: cart.map((c) => ({ ...c, guest: name })) })
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
        items: cart.map((c) => ({ ...c, guest: guestName.trim() || null })),
      })
    }
    setCart([])
    setCartOpen(false)
    setJustSent(true)
    setTab('status')
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
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher compact testIdPrefix="guest-lang" />
        </div>
        {!online && (
          <div className="mb-3 rounded-2xl bg-stone-800 px-4 py-2.5 text-xs font-semibold text-white shadow-sm" role="status" data-testid="guest-offline">
            You&apos;re offline — reconnect to send your order.
          </div>
        )}
        <header className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-amber-700">
              {delivery
                ? (gu.deliveryEyebrow || 'Restora · delivery order')
                : pickup
                  ? (gu.pickupEyebrow || 'Restora · order for pickup')
                  : (gu.orderAtTable || 'Restora · order at table')}
              {lang !== 'en' && <span className="sr-only"> {delivery ? 'Restora · delivery order' : pickup ? 'Restora · order for pickup' : 'Restora · order at table'}</span>}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {heading}
              {!pickup && lang !== 'en' && <span className="sr-only"> {table.name}</span>}
            </h1>
            {liveStatus && (
              <span
                className="mt-1 inline-block rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-800"
                role="status"
              >
                {liveStatus}
                {lang !== 'en' && <span className="sr-only"> {liveStatus}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              data-testid="guest-ask-menu"
              className="min-h-[44px] rounded-full bg-amber-500 px-3.5 text-xs font-bold text-stone-950 shadow-sm active:bg-amber-400"
            >
              ✨ {lang === 'km' ? 'សួរម្ហូប' : lang === 'zh' ? '咨询菜单' : 'Menu help'}
              {lang !== 'en' && <span className="sr-only"> Ask about the menu</span>}
            </button>
            {!pickup && !delivery && (
              <button
                type="button"
                onClick={() => setMoveModalOpen(true)}
                className="min-h-[44px] rounded-full border border-stone-200 bg-white px-3.5 text-xs font-bold text-stone-700 shadow-sm active:bg-stone-100"
              >
                🔄 {dict.common?.transferTable || 'Move'}
              </button>
            )}
            {!pickup && !delivery && <ServerCallControl tableId={tableId} serverCalledAt={table?.serverCalledAt} />}
          </div>
        </header>

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

        <input
          value={guestName}
          onChange={(e) => { setGuestName(e.target.value); setNameError(false) }}
          maxLength={24}
          aria-label="Your name"
          placeholder={delivery
            ? (gu.deliveryNamePlaceholder || 'Your name — required for delivery')
            : pickup
              ? (gu.pickupNamePlaceholder || 'Your name — we\u2019ll call it when your order is ready')
              : (gu.yourName || 'Your name (optional — helps the kitchen)')}
          className={`mt-3 min-h-[44px] w-full rounded-2xl border bg-white px-4 text-sm shadow-sm ${nameError ? 'border-red-400 ring-2 ring-red-200' : 'border-stone-200'}`}
        />
        {nameError && (
          <p className="mt-1 text-xs font-semibold text-red-600" role="alert">
            {delivery ? 'Your name is required for delivery.' : 'Add your name so we can call your order.'}
          </p>
        )}
        {delivery && (
          <>
            <input
              value={deliveryAddress}
              onChange={(e) => { setDeliveryAddress(e.target.value); setAddressError(false) }}
              maxLength={120}
              aria-label="Delivery address"
              placeholder={gu.deliveryAddressPlaceholder || '📍 Delivery address — street, building, apt…'}
              className={`mt-2 min-h-[44px] w-full rounded-2xl border bg-white px-4 text-sm shadow-sm ${addressError ? 'border-red-400 ring-2 ring-red-200' : 'border-stone-200'}`}
            />
            {addressError && (
              <p className="mt-1 text-xs font-semibold text-red-600" role="alert">
                Please enter a delivery address.
              </p>
            )}
          </>
        )}

        {justSent && (
          <div className="mt-3 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow" role="status">
            {gu.sentToKitchen || 'Sent to the kitchen — watch it here live. 🔥'}
          </div>
        )}

        {tab === 'menu' && (
          <>
            <div className="sticky top-0 z-10 -mx-4 mt-4 bg-[var(--guest-bg)]/95 px-4 py-2 backdrop-blur">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {cats.map((c) => (
                  <button
                    key={c} type="button" onClick={() => setCat(c)}
                    className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-bold transition-all ${cat === c ? 'bg-stone-900 text-white shadow-sm' : 'bg-white text-stone-600 shadow-xs'}`}
                  >
                    {c === 'All' ? 'All' : translateCategory(c, lang)}
                    {lang !== 'en' && <span className="sr-only"> {c}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 space-y-6">
              {categorizedSections.map(({ root, directDishes, subGroups, totalCount }) => {
                if (totalCount === 0) return null

                return (
                  <section key={root.id} id={`cat-sec-${root.id}`} className="space-y-3">
                    {/* Sticky Section Header */}
                    <div className="sticky top-14 z-10 -mx-4 flex items-center justify-between bg-[var(--guest-bg)]/95 px-4 py-2 backdrop-blur border-b border-stone-200/50">
                      <div className="flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: root.color || '#f59e0b' }} />
                        <h2 className="text-base font-extrabold text-stone-900 tracking-tight">
                          {translateCategory(root.name, lang)}
                        </h2>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-stone-500 shadow-xs">
                        {totalCount} {totalCount === 1 ? 'dish' : 'dishes'}
                      </span>
                    </div>

                    {/* Direct Dishes */}
                    {directDishes.length > 0 && (
                      <ul className="space-y-2.5">
                        {directDishes.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button" onClick={() => setDetail(m)}
                              className="w-full rounded-3xl bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
                            >
                              {guestPhotos && m.imageUrl && (
                                <DishImage src={m.imageUrl} className="mb-3 h-36 w-full rounded-2xl" />
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
                      </ul>
                    )}

                    {/* Sub-categories Accordions */}
                    {subGroups.map(({ child, dishes }) => {
                      if (dishes.length === 0) return null
                      const isSubCollapsed = !!collapsedSubs[child.id]

                      return (
                        <div key={child.id} className="rounded-3xl border border-stone-200/80 bg-white/60 p-3 shadow-xs">
                          <button
                            type="button"
                            onClick={() => toggleSubCollapse(child.id)}
                            className="flex w-full items-center justify-between py-1 text-left"
                            aria-expanded={!isSubCollapsed}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-stone-400" aria-hidden>└</span>
                              <span className="text-sm font-bold text-stone-800">{translateCategory(child.name, lang)}</span>
                              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
                                {dishes.length}
                              </span>
                            </div>
                            <span className="text-xs text-stone-400 transition-transform">
                              {isSubCollapsed ? '▼' : '▲'}
                            </span>
                          </button>
                          {!isSubCollapsed && (
                            <ul className="mt-2.5 space-y-2.5">
                              {dishes.map((m) => (
                                <li key={m.id}>
                                  <button
                                    type="button" onClick={() => setDetail(m)}
                                    className="w-full rounded-2xl bg-white p-3.5 text-left shadow-xs transition-transform active:scale-[0.99]"
                                  >
                                    {guestPhotos && m.imageUrl && (
                                      <DishImage src={m.imageUrl} className="mb-2.5 h-32 w-full rounded-xl" />
                                    )}
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="font-bold text-stone-900">
                                          {translateDishName(m, lang)}
                                          {lang !== 'en' && <span className="sr-only"> {m.name}</span>}
                                        </div>
                                        <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-stone-500">{m.description || DESC[m.id] || 'Prepared fresh to order.'}</div>
                                      </div>
                                      <div className="tnum shrink-0 font-bold text-amber-700">{money(m.price)}</div>
                                    </div>
                                    {!!m.dietaryTags?.length && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {m.dietaryTags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{tag}</span>)}
                                      </div>
                                    )}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </section>
                )
              })}

              {available.length === 0 && (
                <div className="rounded-3xl bg-white p-6 text-center text-sm text-stone-500">
                  Everything in {translateCategory(cat, lang)} is 86&apos;d right now — the kitchen will fix it. Try another craving.
                </div>
              )}
            </div>

            <p className="mt-3 text-center text-[11px] text-stone-400">
              Dishes the kitchen 86&apos;s disappear from this menu instantly.
            </p>
          </>
        )}

        {tab === 'status' && (
          <div className="mt-4 space-y-2.5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-500">{gu.yourOrders || 'Your orders · live'}</h2>
            {(!pickup || delivery) && (
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <OrderStatusStepper order={order} isDelivery={delivery} />
              </div>
            )}
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
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-500">{pickup ? (gu.yourOrder || 'Your order') : (gu.tableCheck || 'Table check')}</h2>
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
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md bg-white/95 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur" aria-label="Guest navigation">
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
          <Sheet onClose={() => setCartOpen(false)} label="Your order">
            <h2 className="text-xl font-extrabold">Your order · {heading}</h2>
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
            <p className="mt-2 text-center text-[11px] text-stone-400">
              {delivery
                ? 'Your order goes straight to the kitchen — rider is dispatched when ready.'
                : 'Fires straight to the KDS — same as your server sending it.'}
            </p>
          </Sheet>
        )}

        {payOpen && order && (
          <PaySheet order={order} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); setTab('bill') }} />
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
