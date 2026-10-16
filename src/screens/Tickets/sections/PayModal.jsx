import { useId, useMemo, useState } from 'react'
import { Field, Modal, Stepper, btnPrimary } from '../../../components/ui'
import { money, orderCharges } from '../../../lib/models'
import { useRestora } from '../../../lib/store'
import { QRCodeSVG } from 'qrcode.react'

function PayModal({ order, onClose }) {
  const { state, dispatch, issueDocument } = useRestora()
  const menuById = useMemo(() => Object.fromEntries(state.menu.map((m) => [m.id, m])), [state.menu])
  const charges = useMemo(() => orderCharges(order, menuById, state.settings), [order, menuById, state.settings])

  // Split mode: 'full' | 'even' | 'byitem'
  const [split, setSplit] = useState('full')
  const [ways, setWays] = useState(2)
  const [seats, setSeats] = useState(2)
  const [curSeat, setCurSeat] = useState(0)
  const [assign, setAssign] = useState({}) // itemId -> seat index

  // Tips
  const [tipPct, setTipPct] = useState(18)
  const [customTip, setCustomTip] = useState('')
  const tipAmount = customTip !== '' ? Math.max(0, Number(customTip) || 0) : Math.round(((charges.subtotal * tipPct) / 100) * 100) / 100

  // Payment method: 'card' | 'cash' | 'mixed' | 'qr'
  const [method, setMethod] = useState('card')

  // Cash tender calculator
  const grandTotal = Math.round((charges.total + tipAmount) * 100) / 100
  const [cashTenderedStr, setCashTenderedStr] = useState('')
  const cashTendered = Number(cashTenderedStr) || 0
  const cashChange = cashTendered >= grandTotal ? Math.round((cashTendered - grandTotal) * 100) / 100 : 0
  const isCashShort = cashTendered > 0 && cashTendered < grandTotal

  // Mixed payment (Split tender: Cash + Card)
  const [mixedCashStr, setMixedCashStr] = useState('')
  const mixedCash = Math.min(grandTotal, Math.max(0, Number(mixedCashStr) || Math.round(grandTotal / 2)))
  const mixedCard = Math.max(0, Math.round((grandTotal - mixedCash) * 100) / 100)
  const [mixedCashTenderedStr, setMixedCashTenderedStr] = useState('')
  const mixedCashTendered = Number(mixedCashTenderedStr) || 0
  const mixedCashChange = mixedCashTendered >= mixedCash ? Math.round((mixedCashTendered - mixedCash) * 100) / 100 : 0

  // Auto-receipt
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false)
  const [cardType, setCardType] = useState('visa')

  const seatNames = useMemo(() => Array.from({ length: seats }, (_, i) => `Seat ${String.fromCharCode(65 + i)}`), [seats])
  const unassigned = charges.lines.filter((l) => assign[l.id] == null || assign[l.id] >= seats)
  const seatTotals = useMemo(() => {
    const subs = Array.from({ length: seats }, () => 0)
    for (const l of charges.lines) {
      const s = assign[l.id]
      if (s != null && s < seats) subs[s] += l.lineTotal
    }
    const taxRate = state.settings.taxPct || 0
    return subs.map((sub) => {
      const tax = Math.round(sub * taxRate * 100) / 100
      const total = Math.round((sub + tax) * 100) / 100
      return { sub, tax, total }
    })
  }, [charges.lines, assign, seats, state.settings.taxPct])

  const canClose = split !== 'byitem' || unassigned.length === 0
  const table = state.tables.find((t) => t.id === order.tableId)
  const cashInputId = useId()
  const customTipId = useId()

  function handleQuickCash(amount) {
    setCashTenderedStr(String(amount))
  }

  function close() {
    if (!canClose || charges.lines.length === 0) return

    const summary =
      split === 'full'
        ? { kind: 'full' }
        : split === 'even'
          ? { kind: 'even', ways, each: Math.round((grandTotal / ways) * 100) / 100 }
          : { kind: 'byitem', seats, totals: seatTotals.map((s) => Math.round(s.total * 100) / 100) }

    const tenderDetails = {
      method,
      subtotal: charges.subtotal,
      tax: charges.tax,
      tip: tipAmount,
      total: grandTotal,
      cashTendered: method === 'cash' ? cashTendered : (method === 'mixed' ? mixedCashTendered : null),
      changeDue: method === 'cash' ? cashChange : (method === 'mixed' ? mixedCashChange : null),
      mixedDetails: method === 'mixed' ? { cash: mixedCash, card: mixedCard } : null,
      cardType: method === 'card' || method === 'mixed' ? cardType : null,
    }

    const payments = method === 'mixed'
      ? [
          { method: 'cash', amount: mixedCash, at: new Date().toISOString() },
          { method: 'card', amount: mixedCard, at: new Date().toISOString() },
        ]
      : [{ method, amount: grandTotal, at: new Date().toISOString() }]

    dispatch({
      type: 'PAY_ORDER',
      orderId: order.id,
      method: method === 'mixed' ? 'split' : method,
      split: summary,
      tip: tipAmount,
      tenderDetails,
      payments,
    })

    if (autoPrintReceipt && typeof issueDocument === 'function') {
      try {
        issueDocument('receipt', { orderId: order.id })
      } catch {
        /* ignore receipt print errors */
      }
    }

    onClose()
  }

  return (
    <Modal
      title={`Close check · Table ${table?.name || 'Takeout'}`}
      sub={`${charges.lines.length} items · Total ${money(grandTotal)}`}
      onClose={onClose}
      wide
    >
      {/* ── Tabbed Split Mode ── */}
      <div className="mt-3 flex gap-1.5 rounded-xl bg-black/40 p-1.5" role="tablist" aria-label="Split mode">
        {[
          ['full', 'Full check'],
          ['even', 'Split evenly'],
          ['byitem', 'Split by item / seat'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={split === id}
            type="button"
            onClick={() => setSplit(id)}
            className={`min-h-[40px] flex-1 rounded-lg text-xs font-bold transition ${
              split === id ? 'bg-amber-500 text-stone-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Order lines list with Seat Assignment ── */}
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl bg-black/20 p-2 text-sm ring-1 ring-inset ring-white/5">
        {charges.lines.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              disabled={split !== 'byitem'}
              onClick={() => setAssign((a) => ({ ...a, [l.id]: curSeat }))}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                split === 'byitem' ? 'hover:bg-white/5 ring-1 ring-inset ring-transparent hover:ring-[var(--color-ink-600)]' : ''
              }`}
            >
              <span className="text-zinc-200">
                {l.qty}× {l.name}
                {split === 'byitem' && (
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      assign[l.id] != null && assign[l.id] < seats
                        ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/30'
                        : 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30'
                    }`}
                  >
                    {assign[l.id] != null && assign[l.id] < seats ? seatNames[assign[l.id]] : 'tap to assign'}
                  </span>
                )}
              </span>
              <span className="tnum font-medium text-zinc-300">{money(l.lineTotal)}</span>
            </button>
          </li>
        ))}
        {order.items.filter((i) => i.comped && !i.voided).length > 0 && (
          <li className="px-2.5 py-1 text-xs text-zinc-500">
            Comped {money(charges.compTotal)} — removed from bill, preserved in audit.
          </li>
        )}
      </ul>

      {/* ── Even Split Controls ── */}
      {split === 'even' && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <Field label="Split ways">
            <Stepper value={ways} onChange={setWays} min={2} max={8} />
          </Field>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest text-zinc-400">Each person pays</div>
            <div className="tnum text-2xl font-black text-amber-300">{money(grandTotal / ways)}</div>
            <div className="text-[11px] text-zinc-500">{ways} equal shares of {money(grandTotal)}</div>
          </div>
        </div>
      )}

      {/* ── By-Item / Seat Controls ── */}
      {split === 'byitem' && (
        <div className="mt-3 space-y-2 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
          <div className="flex items-center justify-between gap-3">
            <Field label="Guests">
              <Stepper value={seats} onChange={(v) => { setSeats(v); setCurSeat(0) }} min={2} max={6} />
            </Field>
            <div className="flex flex-wrap justify-end gap-1.5">
              {seatNames.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurSeat(i)}
                  aria-pressed={curSeat === i}
                  className={`min-h-[40px] rounded-lg px-2.5 text-xs font-bold ring-1 ring-inset transition ${
                    curSeat === i
                      ? 'bg-sky-500 text-black ring-sky-400 font-extrabold shadow-sm'
                      : 'text-zinc-300 ring-white/10 hover:bg-white/5'
                  }`}
                >
                  {n}
                  <span className="tnum ml-1 opacity-90">{money(seatTotals[i]?.total || 0)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-400">
            {unassigned.length > 0 ? (
              <span className="font-semibold text-red-300">⚠️ {unassigned.length} items unassigned. Tap an item to assign to {seatNames[curSeat]}.</span>
            ) : (
              <span className="font-semibold text-emerald-400">✓ All items assigned across seats.</span>
            )}
          </p>
        </div>
      )}

      {/* ── Tip Selector ── */}
      <div className="mt-3 rounded-xl bg-[var(--color-ink-800)] p-3 ring-1 ring-inset ring-[var(--color-ink-600)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Tip the staff</span>
          <span className="tnum text-xs font-bold text-amber-300">+{money(tipAmount)}</span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {[
            [0, 'No tip'],
            [15, '15%'],
            [18, '18%'],
            [20, '20%'],
            [25, '25%'],
          ].map(([pct, label]) => {
            const active = customTip === '' && tipPct === pct
            const amt = pct > 0 ? (charges.subtotal * pct) / 100 : 0
            return (
              <button
                key={pct}
                type="button"
                onClick={() => { setTipPct(pct); setCustomTip('') }}
                className={`flex flex-col items-center justify-center rounded-lg py-1.5 text-xs font-bold ring-1 ring-inset transition ${
                  active
                    ? 'bg-amber-500 text-stone-950 ring-amber-400'
                    : 'text-zinc-300 ring-white/10 hover:bg-white/5'
                }`}
              >
                <span>{label}</span>
                {pct > 0 && <span className="tnum text-[10px] opacity-75">{money(amt)}</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor={customTipId} className="text-xs text-zinc-400 whitespace-nowrap">Custom $:</label>
          <input
            id={customTipId}
            type="number"
            min="0"
            step="any"
            value={customTip}
            onChange={(e) => setCustomTip(e.target.value)}
            placeholder="0.00"
            className="tnum min-h-[36px] w-full rounded-lg border border-zinc-700 bg-black/40 px-3 text-xs text-white outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* ── Totals breakdown ── */}
      <div className="mt-3 space-y-1 rounded-xl bg-black/40 p-3 text-xs ring-1 ring-inset ring-white/5">
        <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="tnum">{money(charges.subtotal)}</span></div>
        {charges.discount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Discount ({charges.discountPct ? `${(charges.discountPct * 100).toFixed(0)}%` : ''})</span>
            <span className="tnum">−{money(charges.discount)}</span>
          </div>
        )}
        {charges.service > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span>{charges.serviceLabel} ({(charges.servicePct * 100).toFixed(0)}%)</span>
            <span className="tnum">{money(charges.service)}</span>
          </div>
        )}
        <div className="flex justify-between text-zinc-400">
          <span>{charges.taxLabel} ({(charges.taxPct * 100).toFixed(1)}%)</span>
          <span className="tnum">{money(charges.tax)}</span>
        </div>
        {tipAmount > 0 && (
          <div className="flex justify-between text-amber-300">
            <span>Tip ({customTip ? 'Custom' : `${tipPct}%`})</span>
            <span className="tnum">+{money(tipAmount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-white/10 pt-1.5 text-base font-extrabold">
          <span>Total to collect</span>
          <span className="tnum text-amber-300">{money(grandTotal)}</span>
        </div>
      </div>

      {/* ── Payment Method Tabs ── */}
      <div className="mt-3">
        <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Tender type</label>
        <div className="mt-1 grid grid-cols-4 gap-1.5" role="group" aria-label="Payment method">
          {[
            ['card', '💳 Card'],
            ['cash', '💵 Cash'],
            ['mixed', '⚖️ Split Cash+Card'],
            ['qr', '📱 QR / Digital'],
          ].map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={`min-h-[44px] rounded-lg text-xs font-bold ring-1 ring-inset transition ${
                method === m
                  ? 'bg-white/15 text-white ring-amber-400 shadow-sm'
                  : 'text-zinc-400 ring-white/10 hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cash Details & Change Calculator ── */}
      {method === 'cash' && (
        <div className="mt-3 rounded-xl bg-amber-500/10 p-3 ring-1 ring-inset ring-amber-500/30">
          <div className="flex items-center justify-between">
            <label htmlFor={cashInputId} className="text-xs font-bold text-amber-300">Cash received from customer</label>
            <span className="text-[11px] text-zinc-400">Due: {money(grandTotal)}</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {[grandTotal, 10, 20, 50, 100].map((amt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleQuickCash(amt)}
                className="flex-1 rounded-lg bg-black/40 py-1.5 text-xs font-bold text-zinc-200 ring-1 ring-inset ring-white/10 hover:bg-white/10"
              >
                {idx === 0 ? 'Exact' : `$${amt}`}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-400">$</span>
            <input
              id={cashInputId}
              type="number"
              min="0"
              step="any"
              value={cashTenderedStr}
              onChange={(e) => setCashTenderedStr(e.target.value)}
              placeholder={String(grandTotal)}
              className="tnum min-h-[40px] w-full rounded-lg border border-amber-500/40 bg-black/60 px-3 text-sm font-extrabold text-white outline-none focus:border-amber-400"
            />
          </div>
          {cashTendered > 0 && (
            <div className={`mt-2.5 flex items-center justify-between rounded-lg p-2 ${
              isCashShort ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40' : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
            }`}>
              <span className="text-xs font-bold uppercase tracking-wider">
                {isCashShort ? 'Shortfall' : 'Change to return'}
              </span>
              <span className="tnum text-lg font-black">
                {isCashShort ? `-${money(grandTotal - cashTendered)}` : money(cashChange)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Mixed Payment (Cash + Card) ── */}
      {method === 'mixed' && (
        <div className="mt-3 space-y-2 rounded-xl bg-sky-500/10 p-3 ring-1 ring-inset ring-sky-500/30">
          <div className="text-xs font-bold text-sky-300">Split payment across two tenders</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400">Cash part ($)</label>
              <input
                type="number"
                min="0"
                max={grandTotal}
                step="any"
                value={mixedCashStr}
                onChange={(e) => setMixedCashStr(e.target.value)}
                placeholder={String(Math.round(grandTotal / 2))}
                className="tnum mt-1 min-h-[38px] w-full rounded-lg border border-zinc-700 bg-black/60 px-3 text-sm font-bold text-white outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400">Remaining on Card ($)</label>
              <div className="tnum mt-1 flex min-h-[38px] items-center rounded-lg bg-black/40 px-3 text-sm font-black text-sky-300 ring-1 ring-white/10">
                {money(mixedCard)}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between pt-1 text-xs">
            <span className="text-zinc-400">Cash handed over:</span>
            <input
              type="number"
              min="0"
              step="any"
              value={mixedCashTenderedStr}
              onChange={(e) => setMixedCashTenderedStr(e.target.value)}
              placeholder={String(mixedCash)}
              className="tnum w-24 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-right text-xs text-white"
            />
          </div>
          {mixedCashTendered > mixedCash && (
            <div className="flex items-center justify-between text-xs text-emerald-300">
              <span>Change on cash part:</span>
              <span className="tnum font-bold">{money(mixedCashChange)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── QR / Digital Pay ── */}
      {method === 'qr' && (
        <div className="mt-3 flex items-center gap-4 rounded-xl bg-purple-500/10 p-3 ring-1 ring-inset ring-purple-500/30">
          <div className="rounded-lg bg-white p-2 shadow-sm">
            <QRCodeSVG
              value={`restora:pay?order=${order.id}&amount=${grandTotal}&loc=${state.settings.restaurantName || 'Restora'}`}
              size={84}
            />
          </div>
          <div className="flex-1 text-xs">
            <div className="font-bold text-purple-300">Instant QR Payment</div>
            <div className="text-zinc-400">Customer scans with Bakong, PromptPay, or Mobile Banking app.</div>
            <div className="tnum mt-1.5 text-base font-black text-white">{money(grandTotal)}</div>
          </div>
        </div>
      )}

      {/* ── Card Provider Simulator ── */}
      {method === 'card' && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-black/20 p-2.5 text-xs text-zinc-400 ring-1 ring-white/5">
          <span>Card terminal: Simulated Chip / Tap</span>
          <div className="flex gap-1.5">
            {['visa', 'mastercard', 'amex'].map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => setCardType(brand)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase transition ${
                  cardType === brand ? 'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Print Receipt Checkbox ── */}
      <div className="mt-3 flex items-center gap-2">
        <input
          id="auto-receipt-chk"
          type="checkbox"
          checked={autoPrintReceipt}
          onChange={(e) => setAutoPrintReceipt(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-700 bg-black text-amber-500 focus:ring-amber-400"
        />
        <label htmlFor="auto-receipt-chk" className="text-xs text-zinc-300">
          Auto-issue and file receipt document on close
        </label>
      </div>

      {/* ── Action Submit Button ── */}
      <button
        type="button"
        disabled={!canClose || charges.lines.length === 0 || isCashShort}
        onClick={close}
        className={`${btnPrimary} mt-3 w-full`}
      >
        {charges.lines.length === 0
          ? 'Nothing billable on this check'
          : !canClose
            ? `Assign all items to close (${unassigned.length} left)`
            : isCashShort
              ? `Tendered cash short by ${money(grandTotal - cashTendered)}`
              : method === 'cash'
                ? `Collect ${money(grandTotal)} cash ${cashChange > 0 ? `(Change: ${money(cashChange)})` : ''} · Close check`
                : method === 'mixed'
                  ? `Collect ${money(mixedCash)} cash + ${money(mixedCard)} card · Close check`
                  : method === 'qr'
                    ? `Confirm QR payment ${money(grandTotal)} · Close check`
                    : `Charge ${money(grandTotal)} on card · Close check`}
      </button>
    </Modal>
  )
}

export { PayModal }
