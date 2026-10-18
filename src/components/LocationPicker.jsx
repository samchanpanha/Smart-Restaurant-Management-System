// ─── Delivery address + map pin ─────────────────────────────────────
// Shared by the guest checkout/orders editor and the dashboard's order
// panels. One address field, two rider details, and a current-location
// button. The pin is optional: a typed address always works on its own.

import { useState } from 'react'
import { Icon } from './Icon'
import { MapLink } from './MapLink'
import { formatCoordinates, getCurrentLocation, hasCoordinates } from '../lib/geo'
import { translateText, useI18n } from '../lib/i18n'

const fieldCls = (dark, error) => [
  'min-h-[46px] w-full rounded-2xl border px-4 text-sm shadow-sm outline-none transition',
  dark
    ? 'bg-[var(--color-ink-800)] text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-amber-500/30'
    : 'bg-white text-stone-900 placeholder:text-stone-400 focus:ring-2 focus:ring-amber-200',
  error
    ? 'border-red-400 ring-2 ring-red-200/60'
    : dark
      ? 'border-[var(--color-ink-600)]'
      : 'border-stone-200',
].join(' ')

export function LocationPicker({
  value = {},
  onChange,
  tone = 'light',
  addressLabel,
  addressPlaceholder,
  addressError = false,
  showAddress = true,
  compact = false,
}) {
  const { lang } = useI18n()
  const dark = tone === 'dark'
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const pinned = hasCoordinates(value)
  const set = (patch) => onChange?.({ ...value, ...patch })
  const t = (en, km, zh) => translateText(en, lang, { km, zh })
  const addrLabel = addressLabel || t('Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន', '配送地址')
  const addrPlaceholder = addressPlaceholder || t('Street, building, apartment…', 'ផ្លូវ អគារ ផ្ទះសំណាក់…', '街道、楼栋、门牌号…')

  async function useCurrentLocation() {
    if (locating) return
    setLocating(true)
    setError('')
    try {
      const fix = await getCurrentLocation()
      set({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy })
    } catch (err) {
      setError(err?.message || t('We could not find your location. Type your address instead.', 'យើងរកមិនឃើញទីតាំងរបស់អ្នក។ សូមវាយអាសយដ្ឋានដោយដៃជំនួសវិញ។', '无法获取您的位置，请手动输入地址。'))
    } finally {
      setLocating(false)
    }
  }

  const label = 'mb-1 block text-[11px] font-bold uppercase tracking-widest'
  const hint = `mt-1 text-[11px] leading-relaxed ${dark ? 'text-zinc-500' : 'text-stone-400'}`

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      {showAddress && (
        <label className="block">
          <span className={`${label} ${dark ? 'text-zinc-500' : 'text-stone-400'}`}>{addrLabel}</span>
          <input
            value={value.address || ''}
            onChange={(event) => set({ address: event.target.value })}
            maxLength={240}
            aria-label={addrLabel}
            autoComplete="street-address"
            placeholder={addrPlaceholder}
            className={fieldCls(dark, addressError)}
          />
          {addressError && (
            <p className="mt-1 text-xs font-semibold text-red-500" role="alert">
              {t('Add a street address so the rider can find you.', 'បន្ថែមអាសយដ្ឋានផ្លូវ ដើម្បីឱ្យអ្នកដឹករកអ្នកឃើញ។', '请填写详细街道地址以便骑手配送。')}
            </p>
          )}
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={`${label} ${dark ? 'text-zinc-500' : 'text-stone-400'}`}>{t('Building / unit', 'អគារ / ផ្នែក', '单元号/楼栋号')}</span>
          <input
            value={value.unit || ''}
            onChange={(event) => set({ unit: event.target.value })}
            maxLength={40}
            aria-label={lang === 'km' ? 'អគារ / ផ្នែក' : lang === 'zh' ? '单元号/楼栋号' : 'Building or unit'}
            placeholder={t('Apt 4B', 'បន្ទប់ 4B', '例如 4B')}
            className={fieldCls(dark, false)}
          />
        </label>
        <label className="block">
          <span className={`${label} ${dark ? 'text-zinc-500' : 'text-stone-400'}`}>{t('Landmark', 'ចំណុចសំគាល់', '地标')}</span>
          <input
            value={value.landmark || ''}
            onChange={(event) => set({ landmark: event.target.value })}
            maxLength={120}
            aria-label={t('Landmark for the rider', 'ចំណុចសំគាល់សម្រាប់អ្នកដឹក', '骑手参考地标')}
            placeholder={t('Opposite the market', 'ចំកាត់ផ្សារ', '对面市场')}
            className={fieldCls(dark, false)}
          />
        </label>
      </div>

      <div className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 ${
        dark ? 'bg-[var(--color-ink-800)] ring-1 ring-inset ring-[var(--color-ink-600)]' : 'bg-stone-50 ring-1 ring-inset ring-stone-200'
      }`}>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          data-testid="location-use-current"
          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition disabled:opacity-50 ${
            dark
              ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/20'
              : 'bg-white text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-100'
          }`}
        >
          <Icon name="pin" size={14} />
          {locating
            ? t('Finding you…', 'កំពុងរកអ្នក…', '正在定位…')
            : pinned
              ? t('Update my location', 'ធ្វើបច្ចុប្បន្នភាពទីតាំងរបស់ខ្ញុំ', '更新当前位置')
              : t('Use my current location', 'ប្រើទីតាំងបច្ចុប្បន្នរបស់ខ្ញុំ', '使用当前位置')}
        </button>
        {pinned && (
          <MapLink
            lat={value.lat}
            lng={value.lng}
            className={`min-h-[38px] px-2 text-xs font-bold ${dark ? 'text-amber-300' : 'text-amber-700'}`}
          />
        )}
        {pinned && (
          <button
            type="button"
            onClick={() => set({ lat: null, lng: null, accuracy: null })}
            className={`ml-auto min-h-[38px] rounded-xl px-2 text-xs font-semibold ${
              dark ? 'text-zinc-500 hover:text-zinc-300' : 'text-stone-400 hover:text-stone-700'
            }`}
          >
            {t('Clear pin', 'លុបចំណុចផែនទី', '清除定位')}
          </button>
        )}
      </div>

      {pinned && (
        <div className={`flex items-start gap-2 rounded-2xl px-3 py-2 text-[11px] ${
          dark ? 'bg-emerald-500/10 text-emerald-200 ring-1 ring-inset ring-emerald-500/25' : 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
        }`} data-testid="location-pin">
          <Icon name="check" size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <strong className="font-bold">{t('Location pinned.', 'ទីតាំងត្រូវបានដាក់ចំណុច។', '已标记位置。')}</strong>{' '}
            <span className="tnum">{formatCoordinates(value.lat, value.lng)}</span>
            {value.accuracy > 0 && <span className="opacity-75"> · ±{Math.round(value.accuracy)} m</span>}
            <span className="block opacity-75">{t('The rider gets a Google Maps shortcut. A typed address is still required.', 'អ្នកដឹកទទួលបានតំណ Google Maps។ អាសយដ្ឋានដែលសរសេរនៅតែត្រូវការ។', '骑手将收到 Google 地图链接，仍需填写完整地址。')}</span>
          </span>
        </div>
      )}

      {error && (
        <p className={`rounded-xl px-3 py-2 text-[11px] font-semibold ${
          dark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'
        }`} role="alert">
          {error}
        </p>
      )}

      <p className={hint}>{t('We only share this address and pin with the restaurant for this order.', 'យើងចែករំលែកអាសយដ្ឋាន និងចំណុចផែនទីនេះ ជាមួយភោជនីយដ្ឋានសម្រាប់ការកម្មង់នេះតែប៉ុណ្ណោះ។', '此地址和定位信息仅用于本订单餐厅配送。')}</p>
    </div>
  )
}
