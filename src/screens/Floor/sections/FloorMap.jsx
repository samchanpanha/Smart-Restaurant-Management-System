import { useEffect, useMemo, useRef, useState } from 'react'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { translateTableName, translateTableStatus, translateZone, useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'
import { SNAP, MIN_SCALE, MAX_SCALE, toneClass, clampPct, snapPct, zoneBands } from '../shared.js'

function FloorMap({ tables, orders, onOpen }) {
  const { dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const [arrange, setArrange] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const panRef = useRef(null)

  const ordersByCheck = useMemo(() => {
    const map = new Map()
    for (const order of orders || []) {
      if (order && !['paid', 'void'].includes(order.status)) map.set(order.id, order)
    }
    return map
  }, [orders])

  const bands = useMemo(() => zoneBands(tables), [tables])
  const itemCount = (table) => {
    const order = table.currentCheckId ? ordersByCheck.get(table.currentCheckId) : null
    return order ? order.items.length : 0
  }

  const posOf = (table) => (drag && drag.id === table.id
    ? { x: drag.x, y: drag.y }
    : {
      x: Number.isFinite(Number(table.posX)) ? Number(table.posX) : 50,
      y: Number.isFinite(Number(table.posY)) ? Number(table.posY) : 50,
    })

  // Pointer → floor percentage, undoing the pan/zoom transform.
  function toPct(clientX, clientY) {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return { x: 50, y: 50 }
    const rect = viewport.getBoundingClientRect()
    const w = content.offsetWidth || rect.width
    const h = content.offsetHeight || rect.height
    const cx = rect.width / 2
    const cy = rect.height / 2
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top
    const px = cx + (screenX - cx - pan.x) / zoom
    const py = cy + (screenY - cy - pan.y) / zoom
    return { x: clampPct((px / w) * 100), y: clampPct((py / h) * 100) }
  }

  function startTileDrag(event, table) {
    if (!arrange) return
    event.stopPropagation()
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = { id: table.id, offsetX: event.clientX - rect.left - rect.width / 2, offsetY: event.clientY - rect.top - rect.height / 2 }
    const point = toPct(event.clientX - dragRef.current.offsetX, event.clientY - dragRef.current.offsetY)
    setDrag({ id: table.id, x: snapPct(point.x), y: snapPct(point.y) })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveTileDrag(event) {
    if (!dragRef.current) return
    const point = toPct(event.clientX - dragRef.current.offsetX, event.clientY - dragRef.current.offsetY)
    setDrag({ id: dragRef.current.id, x: snapPct(point.x), y: snapPct(point.y) })
  }

  function endTileDrag() {
    if (!dragRef.current) return
    const id = dragRef.current.id
    dragRef.current = null
    setDrag((current) => {
      if (current && current.id === id) {
        dispatch({ type: 'SET_TABLE_LAYOUT', tableId: id, posX: current.x, posY: current.y })
      }
      return null
    })
  }

  function startPan(event) {
    if (dragRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Let tile taps stay taps — capturing here would swallow the click.
    if (event.target.closest?.('button')) return
    panRef.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePan(event) {
    if (!panRef.current) return
    setPan({
      x: panRef.current.ox + (event.clientX - panRef.current.x),
      y: panRef.current.oy + (event.clientY - panRef.current.y),
    })
  }

  function endPan() {
    panRef.current = null
  }

  function nudge(event, table) {
    if (!arrange) return
    const step = event.shiftKey ? SNAP * 2 : SNAP
    const current = posOf(table)
    const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    dispatch({
      type: 'SET_TABLE_LAYOUT',
      tableId: table.id,
      posX: snapPct(current.x + delta[0]),
      posY: snapPct(current.y + delta[1]),
    })
  }

  // Wheel zoom lives on a native listener so it can preventDefault.
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      setZoom((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value - event.deltaY * 0.0015)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor) => setZoom((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value * factor)))
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900">
            {lang === 'km' ? 'ប្លង់តុភោជនីយដ្ឋាន' : lang === 'zh' ? '餐厅餐桌平面图' : 'Restaurant floor'}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {arrange
              ? (lang === 'km' ? 'អូសតុដើម្បីរៀបចំប្លង់ · ចុចលើផ្ទៃខាងក្រោយដើម្បីផ្លាស់ទី' : lang === 'zh' ? '拖动餐桌调整布局 · 拖动空白区域平移' : 'Drag tables to arrange · drag the room to pan')
              : (lang === 'km' ? 'ស្ថានភាពតុផ្ទាល់ · ចុចលើតុសម្រាប់សកម្មភាព' : lang === 'zh' ? '实时桌台状态 · 点击餐桌进行操作' : 'Live table status · tap a table for actions')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {lang === 'km' ? 'ទិដ្ឋភាពផ្ទាល់' : lang === 'zh' ? '实时视图' : 'Live view'}
          </span>
          <div className="flex items-center rounded-xl border border-zinc-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">−</button>
            <button type="button" onClick={resetView} aria-label="Reset view" className="tnum min-w-[44px] rounded-lg px-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-50">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">+</button>
          </div>
          <button
            type="button"
            onClick={() => setArrange((value) => !value)}
            aria-pressed={arrange}
            className={`min-h-9 rounded-xl border px-3 text-xs font-semibold shadow-sm transition-colors ${arrange ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {arrange
              ? (lang === 'km' ? 'រួចរាល់' : lang === 'zh' ? '完成' : 'Done arranging')
              : (lang === 'km' ? 'រៀបចំប្លង់' : lang === 'zh' ? '排列布局' : 'Arrange layout')}
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        className="relative min-h-[420px] cursor-grab touch-none overflow-hidden bg-[#fffdf9] active:cursor-grabbing"
      >
        <div
          ref={contentRef}
          className="relative min-h-[420px] w-full"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
        >
          <div className="pointer-events-none absolute inset-4 rounded-[28px] border-2 border-[#e8e2d8] sm:inset-6" />

          {bands.map((band) => {
            const left = clampPct(band.min - 10)
            const right = clampPct(band.max + 10)
            return (
              <div key={band.zone} className="pointer-events-none absolute inset-y-6 rounded-2xl border border-dashed border-zinc-300/70 bg-white/40" style={{ left: `${left}%`, width: `${Math.max(6, right - left)}%` }}>
                <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
                  {translateZone(band.zone, lang)} · {band.count}
                </span>
              </div>
            )
          })}

          <div className="pointer-events-none absolute left-5 top-4 rounded-xl border border-zinc-200 bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
            {dict.nav?.kitchen || 'Kitchen'}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#fffdf9] px-3 text-[10px] font-semibold text-zinc-500">
            {lang === 'km' ? 'ច្រកចូល' : lang === 'zh' ? '入口' : 'Entrance'}
          </div>

          {tables.map((table) => {
            const { x, y } = posOf(table)
            const shape = table.seats >= 6 ? 'rounded-2xl' : table.seats === 2 ? 'rounded-full' : 'rounded-xl'
            const meta = TABLE_STATUS_META[table.status] || TABLE_STATUS_META.free
            const count = itemCount(table)
            const dragging = drag?.id === table.id
            const showBill = table.status === 'billed' || table.status === 'billing'
            const showSelf = Boolean(table.selfSeated)
            return (
              <div key={table.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                <button
                  type="button"
                  onClick={() => { if (!arrange && !dragging) onOpen(table) }}
                  onPointerDown={(event) => startTileDrag(event, table)}
                  onPointerMove={moveTileDrag}
                  onPointerUp={endTileDrag}
                  onPointerCancel={endTileDrag}
                  onKeyDown={(event) => nudge(event, table)}
                  aria-label={`${table.name}, ${meta.label}, ${table.seats} seats`}
                  aria-grabbed={arrange ? dragging : undefined}
                  title={`${translateTableName(table.name, lang)} · ${translateTableStatus(table.status, lang)}`}
                  className={`group relative flex h-12 w-16 flex-col items-center justify-center ${shape} text-sm font-bold shadow-md ring-4 ring-white/80 transition ${toneClass(table.status)} ${dragging ? 'scale-110 cursor-grabbing' : arrange ? 'cursor-grab' : 'hover:-translate-y-0.5 hover:scale-105'}`}
                >
                  <span className="absolute -top-2 left-1/2 h-2 w-5 -translate-x-1/2 rounded-t-full bg-current opacity-30" />
                  <span className="absolute -bottom-2 left-1/2 h-2 w-5 -translate-x-1/2 rounded-b-full bg-current opacity-30" />
                  {table.name.replace('Table ', '')}

                  {(showBill || showSelf || count > 0) && (
                    <span className="absolute -right-1.5 -top-1.5 flex items-center gap-0.5">
                      {showSelf && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[8px] font-bold text-white ring-2 ring-white" title="Self-seated">S</span>}
                      {showBill && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[8px] font-bold text-white ring-2 ring-white" title="Bill requested">$</span>}
                      {count > 0 && <span className="tnum flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-900/80 px-1 text-[8px] font-bold text-white ring-2 ring-white" title={`${count} items on the check`}>{count}</span>}
                    </span>
                  )}
                </button>
                <span className="pointer-events-none mt-1 flex items-center justify-center gap-1">
                  <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 shadow-sm">{table.seats} {f.seats || 'seats'}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-100 px-5 py-3 text-[11px] text-zinc-600">
        {Object.entries(TABLE_STATUS_META)
          .filter(([status]) => ['free', 'reserved', 'seated', 'ordered', 'billed', 'dirty'].includes(status))
          .map(([status, meta]) => (
            <span key={status} className="inline-flex items-center gap-2">
              <i className={`h-2.5 w-2.5 rounded-full ${toneClass(status).split(' ')[0]}`} />
              {translateTableStatus(status, lang) || meta.label}
            </span>
          ))}
      </div>
    </section>
  )
}


export { FloorMap }
