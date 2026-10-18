import { Field, Toggle, Card, inputCls } from '../primitives'

function PosSection({ draft, patch }) {
  const pos = draft.pos
  function setPos(key, value) {
    patch({ pos: { ...pos, [key]: value } })
  }
  const booking = draft.booking || {
    allowGuestTableChange: true,
    allowGuestReschedule: true,
    rescheduleCutoffMinutes: 60,
    defaultBookingDurationMinutes: 90,
    maxGuestReschedules: 2,
  }
  function setBooking(key, value) {
    patch({ booking: { ...booking, [key]: value } })
  }
  return (
    <div className="space-y-4">
      <Card title="Tips & gratuity" sub="Pre-set percentages for the close-check screen and auto-gratuity thresholds.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Tip presets %" hint="Comma-separated, up to six.">
            <input
              value={pos.tipPresets.map((value) => Math.round(value * 100)).join(', ')}
              onChange={(e) => setPos('tipPresets', e.target.value.split(',').map((part) => Math.max(0, Math.min(0.5, Number(part.trim()) / 100))).filter((value) => value > 0).slice(0, 6))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Auto-gratuity %">
            <input type="number" min="0" max="30" step="0.5" value={(pos.autoGratuityPct * 100).toFixed(1)} onChange={(e) => setPos('autoGratuityPct', Math.max(0, Math.min(1, Number(e.target.value) / 100)))} className={`${inputCls} tnum`} />
          </Field>
          <Field label="Auto-gratuity from party size">
            <input type="number" min="1" max="40" value={pos.autoGratuityPartySize} onChange={(e) => setPos('autoGratuityPartySize', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle label="Tips enabled" hint="Shows the tip line on the close-check screen and receipts." checked={pos.tipsEnabled} onChange={(value) => setPos('tipsEnabled', value)} />
          <Toggle label="Allow split checks" hint="Split by seat, even ways, or by item." checked={pos.allowSplit} onChange={(value) => setPos('allowSplit', value)} />
          <Toggle label="Allow discounts" checked={pos.allowDiscounts} onChange={(value) => setPos('allowDiscounts', value)} />
          <Toggle label="Require manager for void/comp" hint="Voids and comps stay in the audit trail either way." checked={pos.requireManagerVoid} onChange={(value) => setPos('requireManagerVoid', value)} />
          <Toggle label="Guest QR ordering" hint="Turns the table QR tent cards on or off for this store." checked={pos.guestQrOrdering} onChange={(value) => setPos('guestQrOrdering', value)} />
        </div>
      </Card>

      <Card title="Pickup & delivery" sub="Guest checkout quotes, delivery fees, and the ways an off-table order can settle.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Delivery fee" hint="Base currency, added to delivery orders.">
            <input
              type="number"
              min="0"
              max="200"
              step="0.5"
              value={pos.deliveryFee ?? 3.5}
              onChange={(e) => setPos('deliveryFee', Math.max(0, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Minimum delivery order" hint="0 means no minimum.">
            <input
              type="number"
              min="0"
              max="1000"
              step="0.5"
              value={pos.minDeliveryOrder ?? 0}
              onChange={(e) => setPos('minDeliveryOrder', Math.max(0, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Pickup ETA (mins)" hint="Quoted after the guest orders.">
            <input
              type="number"
              min="5"
              max="180"
              value={pos.pickupEtaMinutes ?? 20}
              onChange={(e) => setPos('pickupEtaMinutes', Math.max(5, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Delivery ETA (mins)">
            <input
              type="number"
              min="5"
              max="180"
              value={pos.deliveryEtaMinutes ?? 35}
              onChange={(e) => setPos('deliveryEtaMinutes', Math.max(5, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle label="Pickup orders" hint="Guests can order ahead and collect at the counter." checked={pos.pickupEnabled !== false} onChange={(value) => setPos('pickupEnabled', value)} />
          <Toggle label="Delivery orders" hint="Guests can enter an address and request a rider." checked={pos.deliveryEnabled !== false} onChange={(value) => setPos('deliveryEnabled', value)} />
          <Toggle label="Pay at pickup" hint="Guest settles when they collect the order." checked={pos.payAtPickup !== false} onChange={(value) => setPos('payAtPickup', value)} />
          <Toggle label="Pay at the door" hint="Guest settles with the rider on delivery." checked={pos.payAtDoor !== false} onChange={(value) => setPos('payAtDoor', value)} />
        </div>
      </Card>

      <Card title="Reservations & Table Transfers" sub="Self-service rescheduling cutoff windows, modification limits, and table change policies.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Reschedule cutoff (mins)" hint="Minutes before booking when self-service locks.">
            <input
              type="number"
              min="0"
              max="1440"
              value={booking.rescheduleCutoffMinutes ?? 60}
              onChange={(e) => setBooking('rescheduleCutoffMinutes', Math.max(0, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Default duration (mins)" hint="Standard seating slot duration.">
            <input
              type="number"
              min="15"
              max="360"
              value={booking.defaultBookingDurationMinutes ?? 90}
              onChange={(e) => setBooking('defaultBookingDurationMinutes', Math.max(15, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label="Max guest reschedules" hint="Limit self-service date/time changes per booking.">
            <input
              type="number"
              min="1"
              max="10"
              value={booking.maxGuestReschedules ?? 2}
              onChange={(e) => setBooking('maxGuestReschedules', Math.max(1, Number(e.target.value)))}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Toggle
            label="Allow guest rescheduling"
            hint="Allow guests to update their booking time & date before the cutoff window."
            checked={booking.allowGuestReschedule !== false}
            onChange={(value) => setBooking('allowGuestReschedule', value)}
          />
          <Toggle
            label="Allow guest table change"
            hint="Allow guests to select preferred tables or request seated table moves."
            checked={booking.allowGuestTableChange !== false}
            onChange={(value) => setBooking('allowGuestTableChange', value)}
          />
        </div>
      </Card>

      <Card title="Printers" sub="Named destinations, printed on the ticket header so runners know where it came from.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Receipt printer">
            <input value={pos.printerReceipt} onChange={(e) => setPos('printerReceipt', e.target.value)} maxLength={60} className={inputCls} placeholder="Front counter · thermal 80mm" />
          </Field>
          <Field label="Kitchen printer">
            <input value={pos.printerKitchen} onChange={(e) => setPos('printerKitchen', e.target.value)} maxLength={60} className={inputCls} placeholder="Expo line · thermal 80mm" />
          </Field>
          <Field label="Kitchen copies">
            <input type="number" min="1" max="4" value={pos.printTicketCopies} onChange={(e) => setPos('printTicketCopies', Number(e.target.value))} className={`${inputCls} tnum`} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ─── Alerts ────────────────────────────────────────────────────────


export { PosSection }
