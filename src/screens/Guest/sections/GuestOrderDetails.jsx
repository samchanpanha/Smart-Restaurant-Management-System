// ─── Who the order is for, and where it goes ────────────────────────
// The Orders tab is the guest's chance to fix a typo in a name, phone,
// street, or pin before the food leaves. Edits stop at the kitchen door:
// once a delivery is out, only the restaurant can change the route.

import { useState } from 'react'
import { LocationPicker } from '../../../components/LocationPicker'
import { MapLink } from '../../../components/MapLink'
import { Sheet } from '../../../components/ui'
import { useRestora } from '../../../lib/store'
import { useI18n } from '../../../lib/i18n'

export function GuestOrderDetails({ order, guestToken = null }) {
  const { dispatch } = useRestora()
  const { lang } = useI18n()
  // const st = state || {}
  const isDelivery = order.type === 'delivery'
  const locked = isDelivery && ['out_for_delivery', 'delivered', 'cancelled'].includes(order.deliveryStatus)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState({})
  const [nameError, setNameError] = useState(false)
  const [addressError, setAddressError] = useState(false)

  const customer = order.customer || {}
  const address = order.deliveryAddress || customer.address || ''
  const missing = !customer.name || !customer.phone || (isDelivery && !address)

  function startEdit() {
    setName(customer.name || '')
    setPhone(customer.phone || '')
    setLocation({
      address: address,
      unit: customer.unit || '',
      landmark: customer.landmark || '',
      lat: customer.lat ?? null,
      lng: customer.lng ?? null,
      accuracy: customer.accuracy ?? null,
    })
    setNameError(false)
    setAddressError(false)
    setOpen(true)
  }

  function save() {
    const nextName = name.trim()
    const nextPhone = phone.trim()
    if (!nextName) {
      setNameError(true)
      return
    }
    if (isDelivery && !String(location.address || '').trim()) {
      setAddressError(true)
      return
    }
    dispatch({
      type: 'UPDATE_GUEST_ORDER',
      orderId: order.id,
      guestToken,
      customer: {
        name: nextName,
        phone: nextPhone,
        address: isDelivery ? String(location.address || '').trim() : '',
        unit: isDelivery ? location.unit || '' : '',
        landmark: isDelivery ? location.landmark || '' : '',
        lat: isDelivery ? location.lat : null,
        lng: isDelivery ? location.lng : null,
        accuracy: isDelivery ? location.accuracy : null,
        customerId: customer.customerId,
      },
      deliveryAddress: isDelivery ? location.address : undefined,
    })
    setOpen(false)
  }

  return (
    <>
      <section className="rounded-3xl bg-white p-4 shadow-sm" data-testid="guest-order-details">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
              {isDelivery ? (lang === 'km' ? 'ដឹកជញ្ជូនទៅ' : lang === 'zh' ? '配送至' : 'Delivering to') : (lang === 'km' ? 'មកយកនៅបញ្ជរ' : lang === 'zh' ? '到柜台取餐' : 'Collect at the counter')}
            </p>
            <p className="mt-0.5 truncate text-sm font-extrabold text-stone-900">
              {customer.name || (lang === 'km' ? 'បន្ថែមឈ្មោះរបស់អ្នក' : lang === 'zh' ? '请添加姓名' : 'Add your name')}
            </p>
            {customer.phone ? (
              <a href={`tel:${customer.phone}`} className="mt-0.5 inline-flex min-h-[28px] items-center text-xs font-semibold text-amber-700">
                {customer.phone}
              </a>
            ) : (
              <p className="mt-0.5 text-xs font-semibold text-amber-700">{lang === 'km' ? 'បន្ថែមលេខទូរស័ព្ទ' : lang === 'zh' ? '请添加手机号' : 'Add a phone number'}</p>
            )}
            {isDelivery ? (
              address ? (
                <p className="mt-1 text-xs leading-relaxed text-stone-600">
                  {address}
                  {customer.unit ? ` · ${customer.unit}` : ''}
                  {customer.landmark ? <span className="block text-stone-400">{customer.landmark}</span> : null}
                </p>
              ) : (
                <p className="mt-1 text-xs font-semibold text-amber-700">{lang === 'km' ? 'បន្ថែមអាសយដ្ឋានដឹកជញ្ជូន' : lang === 'zh' ? '请添加配送地址' : 'Add a delivery address'}</p>
              )
            ) : null}
            {order.eta && <p className="mt-1 text-[11px] font-semibold text-stone-500">{lang === 'km' ? 'រំពឹងទុក' : lang === 'zh' ? '预计' : 'Estimated'} {order.eta}</p>}
            {isDelivery && (
              <MapLink
                lat={customer.lat}
                lng={customer.lng}
                address={address}
                className="mt-1 text-[11px] font-bold text-amber-700"
              >
                {lang === 'km' ? 'បើកទីតាំងក្នុង Google Maps' : lang === 'zh' ? '在 Google 地图中打开' : 'Open location in Google Maps'}
              </MapLink>
            )}
          </div>
          {!locked && (
            <button
              type="button"
              onClick={startEdit}
              className="min-h-[38px] shrink-0 rounded-xl border border-stone-200 bg-white px-3 text-xs font-bold text-stone-600 hover:bg-stone-50"
            >
              {lang === 'km' ? 'កែប្រែព័ត៌មាន' : lang === 'zh' ? '编辑详情' : 'Edit details'}
            </button>
          )}
        </div>
        {missing && !locked && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-900" role="status">
            {(() => {
              const need = !customer.name ? 'name' : !customer.phone ? 'phone' : 'address'
              if (lang === 'km') {
                return need === 'name'
                  ? 'សូមបន្ថែមឈ្មោះរបស់អ្នក ដើម្បីផ្ទះបាយ និងអ្នកដឹកអាចទាក់ទងអ្នកបាន។'
                  : need === 'phone'
                    ? 'សូមបន្ថែមលេខទូរស័ព្ទ ដើម្បីផ្ទះបាយ និងអ្នកដឹកអាចទាក់ទងអ្នកបាន។'
                    : 'សូមបន្ថែមអាសយដ្ឋានដឹកជញ្ជូន ដើម្បីផ្ទះបាយ និងអ្នកដឹកអាចទាក់ទងអ្នកបាន។'
              }
              if (lang === 'zh') {
                return need === 'name'
                  ? '请填写姓名，以便后厨和骑手联系您。'
                  : need === 'phone'
                    ? '请填写手机号，以便后厨和骑手联系您。'
                    : '请填写配送地址，以便后厨和骑手联系您。'
              }
              return `Add ${need === 'name' ? 'your name' : need === 'phone' ? 'a phone number' : 'a delivery address'} so the kitchen and rider can reach you.`
            })()}
          </p>
        )}
        {locked && (
          <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-[11px] font-semibold text-stone-500" role="status">
            {lang === 'km' ? 'អ្នកដឹកកំពុងធ្វើដំណើរ។ សូមទាក់ទងភោជនីយដ្ឋានប្រសិនបើមានបញ្ហា។' : lang === 'zh' ? '骑手已出发。如有问题请联系餐厅。' : 'The rider is on the way. Call the restaurant if something is wrong.'}
          </p>
        )}
      </section>

      {open && (
        <Sheet onClose={() => setOpen(false)} label="Edit order details" tall>
          <h2 className="text-xl font-extrabold text-stone-900">{lang === 'km' ? 'ព័ត៌មានលម្អិតនៃការកម្មង់' : lang === 'zh' ? '订单详情' : 'Order details'}</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            {lang === 'km' ? 'ប្រើសម្រាប់ការកម្មង់នេះតែមួយ។ ផ្ទះបាយឃើញព័ត៌មានដូចគ្នា។' : lang === 'zh' ? '仅用于本订单，后厨将看到相同信息。' : 'Used for this order only. The kitchen sees the same details.'}
          </p>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">{lang === 'km' ? 'ឈ្មោះ' : lang === 'zh' ? '姓名' : 'Name'}</span>
              <input
                value={name}
                onChange={(event) => { setName(event.target.value); setNameError(false) }}
                maxLength={60}
                aria-label={lang === 'km' ? 'ឈ្មោះ' : lang === 'zh' ? '姓名' : 'Order name'}
                autoComplete="name"
                className={`min-h-[46px] w-full rounded-2xl border bg-white px-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-200 ${nameError ? 'border-red-400 ring-2 ring-red-200' : 'border-stone-200'}`}
              />
              {nameError && <p className="mt-1 text-xs font-semibold text-red-600" role="alert">{lang === 'km' ? 'សូមបន្ថែមឈ្មោះសម្រាប់ការកម្មង់នេះ។' : lang === 'zh' ? '请填写本订单的姓名。' : 'Add the name for this order.'}</p>}
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">{lang === 'km' ? 'ទូរស័ព្ទ' : lang === 'zh' ? '手机号' : 'Phone'}</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={30}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-label={lang === 'km' ? 'លេខទូរស័ព្ទ' : lang === 'zh' ? '手机号' : 'Order phone'}
                placeholder={lang === 'km' ? 'សម្រាប់ការអាប់ដេតនៃការកម្មង់' : lang === 'zh' ? '用于订单更新' : 'For order updates'}
                className="min-h-[46px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-200"
              />
            </label>
            {isDelivery && (
              <LocationPicker
                value={location}
                onChange={setLocation}
                addressError={addressError}
                addressLabel={lang === 'km' ? 'អាសយដ្ឋានដឹកជញ្ជូន' : lang === 'zh' ? '配送地址' : 'Delivery address'}
              />
            )}
          </div>
          <button
            type="button"
            onClick={save}
            data-testid="guest-order-details-save"
            className="mt-4 min-h-[50px] w-full rounded-2xl bg-stone-900 text-sm font-extrabold text-white shadow-sm"
          >
            {lang === 'km' ? 'រក្សាទុកព័ត៌មាន' : lang === 'zh' ? '保存详情' : 'Save details'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 min-h-[44px] w-full rounded-2xl text-sm font-bold text-stone-500"
          >
            {lang === 'km' ? 'បោះបង់' : lang === 'zh' ? '取消' : 'Cancel'}
          </button>
        </Sheet>
      )}
    </>
  )
}
