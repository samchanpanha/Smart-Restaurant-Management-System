import { useState } from 'react'
import { LocationPicker } from '../../../components/LocationPicker'
import { MapLink } from '../../../components/MapLink'
import { Field, Modal, btnPrimary, inputCls } from '../../../components/ui'
import { hasCoordinates } from '../../../lib/geo'
import { useRestora } from '../../../lib/store'

function OrderDetailsModal({ order, onClose }) {
  const { dispatch } = useRestora()
  const isDelivery = order.type === 'delivery'
  const [name, setName] = useState(order.customer?.name || '')
  const [phone, setPhone] = useState(order.customer?.phone || '')
  const [location, setLocation] = useState({
    address: order.customer?.address || '',
    unit: order.customer?.unit || '',
    landmark: order.customer?.landmark || '',
    lat: order.customer?.lat ?? null,
    lng: order.customer?.lng ?? null,
    accuracy: order.customer?.accuracy ?? null,
  })
  const [fee, setFee] = useState(String(order.deliveryFee ?? 0))
  const [eta, setEta] = useState(order.eta ? order.eta.slice(0, 16) : '')

  function save() {
    dispatch({
      type: 'SET_ORDER_DETAILS',
      orderId: order.id,
      customer: {
        name,
        phone,
        address: isDelivery ? location.address : '',
        unit: isDelivery ? location.unit : '',
        landmark: isDelivery ? location.landmark : '',
        lat: isDelivery ? location.lat : null,
        lng: isDelivery ? location.lng : null,
        accuracy: isDelivery ? location.accuracy : null,
      },
      deliveryAddress: isDelivery ? location.address : undefined,
      deliveryFee: isDelivery ? Number(fee) || 0 : 0,
      eta: eta ? new Date(eta).toISOString() : null,
    })
    onClose()
  }

  return (
    <Modal
      title="Order details"
      sub={isDelivery ? 'Delivery customer, address, and fee.' : 'Takeout customer and pickup time.'}
      onClose={onClose}
    >
      <div className="mt-3 space-y-4">
        <Field label="Customer name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ava Chen" className={inputCls} maxLength={60} aria-label="Order customer name" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="012 345 678" className={inputCls} maxLength={30} />
          </Field>
          <Field label="ETA / pickup time">
            <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {isDelivery && (
          <>
            <LocationPicker
              value={location}
              onChange={setLocation}
              tone="dark"
              addressLabel="Delivery address"
              addressPlaceholder="12 Riverside Rd"
            />
            {!hasCoordinates(location) && (
              <MapLink
                address={location.address}
                className="text-xs font-semibold text-amber-300"
                label="Open address in Google Maps"
              />
            )}
            <Field label="Delivery fee">
              <input type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} />
            </Field>
          </>
        )}
        <button type="button" className={btnPrimary} onClick={save}>Save details</button>
      </div>
    </Modal>
  )
}

// ─── Screen ─────────────────────────────────────────────────────


export { OrderDetailsModal }
