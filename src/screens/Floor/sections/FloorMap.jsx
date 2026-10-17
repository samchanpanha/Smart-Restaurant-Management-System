import { useEffect, useMemo, useRef, useState } from 'react'
import { TABLE_STATUS_META } from '../../../lib/constants'
import { translateTableName, translateTableStatus, translateZone, useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'
import { ZoneEditorModal } from './ZoneEditorModal.jsx'
import { SNAP, MIN_SCALE, MAX_SCALE, toneClass, clampPct, snapPct, zoneBands } from '../shared.js'

// Tile geometry in px (w-16 h-12 on the button) so the resize knob tracks
// the scaled footprint without inventing a second layout.
const TILE_W = 64
const TILE_H = 48
const SCALE_MIN = 0.75
const SCALE_MAX = 3
const SCALE_STEP = 0.25
const ZONE_MIN = 10

// Room pixels per axis. 0 means auto-fit; the steppers land on 50s.
const ROOM_MIN_W = 600
const ROOM_MAX_W = 3000
const ROOM_MIN_H = 400
const ROOM_MAX_H = 1800
const ROOM_STEP = 50

const scaleClamp = (value) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(Number(value) * 4) / 4))
const roomClampW = (value) => Math.min(ROOM_MAX_W, Math.max(ROOM_MIN_W, Math.round(Number(value) / ROOM_STEP) * ROOM_STEP))
const roomClampH = (value) => Math.min(ROOM_MAX_H, Math.max(ROOM_MIN_H, Math.round(Number(value) / ROOM_STEP) * ROOM_STEP))

function FloorMap({ tables, orders, onOpen, floorZones, floor }) {
  const { dispatch } = useRestora()
  const { lang, dict } = useI18n()
  const f = dict.floor || {}
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const [arrange, setArrange] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState(null) // { id, x, y } — live tile position
  const [resize, setResize] = useState(null) // { id, scale } — live tile size
  const [zoneDrag, setZoneDrag] = useState(null) // { id, x, y } — live zone rect
  const [zoneResize, setZoneResize] = useState(null) // { id, w, h }
  const [roomDrag, setRoomDrag] = useState(null) // { w, h } — live room size
  const [zoneEditor, setZoneEditor] = useState(null) // zone record under edit
  const dragRef = useRef(null)
  const tileResizeRef = useRef(null)
  const zoneDragRef = useRef(null)
  const zoneResizeRef = useRef(null)
  const roomResizeRef = useRef(null)
  const panRef = useRef(null)
  // Mirrored into a ref for native pointer math (drag deltas read it
  // outside the render cycle).
  const zoomRef = useRef(1)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const roomW = Math.max(0, Math.round(Number(floor?.roomW) || 0))
  const roomH = Math.max(0, Math.round(Number(floor?.roomH) || 0))
  const zoneList = Array.isArray(floorZones) ? floorZones : []

  const ordersByCheck = useMemo(() => {
    const map = new Map()
    for (const order of orders || []) {
      if (order && !['paid', 'void'].includes(order.status)) map.set(order.id, order)
    }
    return map
  }, [orders])

  const bands = useMemo(() => {
    // Zones with a record draw from their own rect; only zone labels that
    // never got a record fall back to the classic derived bands.
    const defined = new Set(zoneList.map((zone) => zone.name))
    const orphans = (tables || []).filter((table) => !defined.has(table.zone || 'Main'))
    return zoneBands(orphans)
  }, [tables, zoneList])

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
  const scaleOf = (table) => (resize && resize.id === table.id
    ? Number(resize.scale)
    : (Number.isFinite(Number(table.tileScale)) && Number(table.tileScale) > 0 ? Number(table.tileScale) : 1))

  const zoneRectOf = (zone) => ({
    x: zoneDrag && zoneDrag.id === zone.id ? Number(zoneDrag.x) : zone.x,
    y: (zoneDrag && zoneDrag.id === zone.id) ? Number(zoneDrag.y) : zone.y,
    w: zoneResize && zoneResize.id === zone.id ? Number(zoneResize.w) : zone.w,
    h: zoneResize && zoneResize.id === zone.id ? Number(zoneResize.h) : zone.h,
  })

  // Pointer → floor percentage, undoing the pan/zoom transform.
  function toPct(clientX, clientY) {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return { x: 50, y: 50 }
    const rect = viewport.getBoundingClientRect()
    const w = content.offsetWidth || rect.width
    const h = content.offsetHeight || rect.height
    if (!(w > 0) || !(h > 0)) return { x: 50, y: 50 }
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

  // Resize a tile: the knob's distance from the tile center sets the scale.
  function startTileResize(event, table) {
    if (!arrange) return
    event.stopPropagation()
    event.preventDefault()
    const wrapper = event.currentTarget.parentElement
    const button = wrapper?.querySelector('button')
    const rect = (button || event.currentTarget).getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    tileResizeRef.current = {
      id: table.id,
      cx,
      cy,
      startDist: Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy)),
      startScale: scaleOf(table),
    }
    setResize({ id: table.id, scale: scaleOf(table) })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveTileResize(event) {
    if (!tileResizeRef.current) return
    const { id, cx, cy, startDist, startScale } = tileResizeRef.current
    const dist = Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy))
    setResize({ id, scale: scaleClamp(startScale * (dist / startDist)) })
  }

  function endTileResize() {
    if (!tileResizeRef.current) return
    const id = tileResizeRef.current.id
    tileResizeRef.current = null
    setResize((current) => {
      if (current && current.id === id) {
        const table = (tables || []).find((entry) => entry.id === id)
        if (table) {
          dispatch({
            type: 'SET_TABLE_LAYOUT',
            tableId: id,
            posX: Number.isFinite(Number(table.posX)) ? Number(table.posX) : 50,
            posY: Number.isFinite(Number(table.posY)) ? Number(table.posY) : 50,
            scale: current.scale,
          })
        }
      }
      return null
    })
  }

  // Zone rectangles: drag the body to move, the SE grip to resize.
  function startZoneDrag(event, zone) {
    if (!arrange) return
    event.stopPropagation()
    event.preventDefault()
    const rectScreen = event.currentTarget.getBoundingClientRect()
    const fullH = (zone.h ?? 100) >= 99.5
    const w = rectScreen.width || 1
    const h = rectScreen.height || 1
    zoneDragRef.current = {
      id: zone.id,
      fullH,
      offXPct: ((event.clientX - rectScreen.left) / w) * (zone.w || 1) || 0,
      offYPct: fullH ? undefined : ((event.clientY - rectScreen.top) / h) * (zone.h || 1) || 0,
    }
    setZoneDrag({ id: zone.id, x: zone.x, y: zone.y })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveZoneDrag(event) {
    if (!zoneDragRef.current) return
    const point = toPct(event.clientX, event.clientY)
    const ref = zoneDragRef.current
    setZoneDrag((current) => {
      if (!current || current.id !== ref.id) return current
      return {
        id: ref.id,
        x: snapPct(point.x - ref.offXPct),
        y: ref.fullH ? current.y : snapPct(point.y - ref.offYPct),
      }
    })
  }

  function endZoneDrag() {
    if (!zoneDragRef.current) return
    const id = zoneDragRef.current.id
    zoneDragRef.current = null
    setZoneDrag((current) => {
      if (current && current.id === id) {
        dispatch({ type: 'UPDATE_FLOOR_ZONE', zoneId: id, patch: { rect: { x: current.x, y: current.y } } })
      }
      return null
    })
  }

  function startZoneResize(event, zone) {
    if (!arrange) return
    event.stopPropagation()
    event.preventDefault()
    zoneResizeRef.current = { id: zone.id }
    setZoneResize({ id: zone.id, w: zone.w, h: zone.h })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveZoneResize(event) {
    if (!zoneResizeRef.current) return
    const ref = zoneResizeRef.current
    const zone = zoneList.find((entry) => entry.id === ref.id)
    if (!zone) return
    const point = toPct(event.clientX, event.clientY)
    const w = Math.min(100 - zone.x, Math.max(ZONE_MIN, snapPct(point.x - zone.x)))
    const h = Math.min(100 - zone.y, Math.max(ZONE_MIN, snapPct(point.y - zone.y)))
    setZoneResize({ id: zone.id, w, h })
  }

  function endZoneResize() {
    if (!zoneResizeRef.current) return
    const id = zoneResizeRef.current.id
    zoneResizeRef.current = null
    setZoneResize((current) => {
      if (current && current.id === id) {
        dispatch({ type: 'UPDATE_FLOOR_ZONE', zoneId: id, patch: { rect: { w: current.w, h: current.h } } })
      }
      return null
    })
  }

  // Room corner: grow the room past the viewport; zoom-scaled so the felt
  // speed matches what is on screen.
  function startRoomResize(event) {
    if (!arrange) return
    event.stopPropagation()
    event.preventDefault()
    const content = contentRef.current
    if (!content) return
    roomResizeRef.current = {
      x: event.clientX,
      y: event.clientY,
      startW: content.offsetWidth,
      startH: content.offsetHeight,
    }
    setRoomDrag({ w: content.offsetWidth, h: content.offsetHeight })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveRoomResize(event) {
    if (!roomResizeRef.current) return
    const { x, y, startW, startH } = roomResizeRef.current
    const factor = 1 / (zoomRef.current || 1)
    setRoomDrag({
      w: roomClampW(startW + (event.clientX - x) * factor),
      h: roomClampH(startH + (event.clientY - y) * factor),
    })
  }

  function endRoomResize() {
    if (!roomResizeRef.current) return
    roomResizeRef.current = null
    setRoomDrag((current) => {
      if (current) dispatch({ type: 'SET_FLOOR_ROOM', roomW: current.w, roomH: current.h })
      return null
    })
  }

  const bumpRoom = (axis, delta) => {
    const content = contentRef.current
    const currentW = roomW || content?.offsetWidth || 960
    const currentH = roomH || content?.offsetHeight || 420
    if (axis === 'w') dispatch({ type: 'SET_FLOOR_ROOM', roomW: roomClampW(currentW + delta), roomH })
    else dispatch({ type: 'SET_FLOOR_ROOM', roomW, roomH: roomClampH(currentH + delta) })
  }

  const fitRoom = () => {
    dispatch({ type: 'SET_FLOOR_ROOM', roomW: 0, roomH: 0 })
    resetView()
  }

  function startPan(event) {
    if (dragRef.current || tileResizeRef.current || zoneDragRef.current || zoneResizeRef.current || roomResizeRef.current) return
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
    const scale = scaleOf(table)
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      dispatch({ type: 'SET_TABLE_LAYOUT', tableId: table.id, posX: current.x, posY: current.y, scale: scaleClamp(scale + SCALE_STEP) })
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      dispatch({ type: 'SET_TABLE_LAYOUT', tableId: table.id, posX: current.x, posY: current.y, scale: scaleClamp(scale - SCALE_STEP) })
      return
    }
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
              ? (lang === 'km' ? 'អូសតុ/តំបន់ដើម្បីរៀបចំ · ប្រើសង្កត់ក្រោមដើម្បីធ្វើឱ្យធំជាង · អូសផ្ទៃខាងក្រោយដើម្បីផ្លាស់ទី' : lang === 'zh' ? '拖动餐桌/区域调整布局 · 用角柄缩放 · 拖动空白区域平移' : 'Drag tables & zones to arrange · corner grips resize · drag the room to pan')
              : (lang === 'km' ? 'ស្ថានភាពតុផ្ទាល់ · ចុចលើតុសម្រាប់សកម្មភាព' : lang === 'zh' ? '实时桌台状态 · 点击餐桌进行操作' : 'Live table status · tap a table for actions')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {arrange && (
            <div className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2 py-0.5 shadow-sm">
              <button type="button" onClick={() => bumpRoom('w', -ROOM_STEP)} aria-label="Room width smaller" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">−</button>
              <span className="tnum min-w-[64px] text-center text-[11px] font-semibold text-zinc-600" title="Room width">
                W {roomDrag ? roomDrag.w : roomW || (lang === 'km' ? 'ស្វ័យប្រវត្តិ' : lang === 'zh' ? '自适应' : 'auto')}
              </span>
              <button type="button" onClick={() => bumpRoom('w', ROOM_STEP)} aria-label="Room width larger" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">+</button>
              <span className="mx-1 h-4 w-px bg-zinc-200" />
              <button type="button" onClick={() => bumpRoom('h', -ROOM_STEP)} aria-label="Room height smaller" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">−</button>
              <span className="tnum min-w-[64px] text-center text-[11px] font-semibold text-zinc-600" title="Room height">
                H {roomDrag ? roomDrag.h : roomH || (lang === 'km' ? 'ស្វ័យប្រវត្តិ' : lang === 'zh' ? '自适应' : 'auto')}
              </span>
              <button type="button" onClick={() => bumpRoom('h', ROOM_STEP)} aria-label="Room height larger" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-50">+</button>
              <span className="mx-1 h-4 w-px bg-zinc-200" />
              <button type="button" onClick={fitRoom} className="rounded-lg px-2 text-[11px] font-bold text-orange-600 hover:bg-orange-50">
                {lang === 'km' ? 'ធ្វើឱ្យសម' : lang === 'zh' ? '适合窗口' : 'Fit'}
              </button>
            </div>
          )}
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
          className="relative min-h-[420px]"
          style={{
            width: (roomDrag ? roomDrag.w : roomW) || '100%',
            height: roomDrag || roomH ? `${roomDrag ? roomDrag.h : roomH}px` : undefined,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <div className={`pointer-events-none absolute inset-4 rounded-[28px] border-2 sm:inset-6 ${roomW || roomH ? 'border-orange-300' : 'border-[#e8e2d8]'}`} />

          {bands.map((band) => {
            const left = clampPct(band.min - 10)
            const right = clampPct(band.max + 10)
            return (
              <div key={`band_${band.zone}`} className="pointer-events-none absolute inset-y-6 rounded-2xl border border-dashed border-zinc-300/70 bg-white/40" style={{ left: `${left}%`, width: `${Math.max(6, right - left)}%` }}>
                <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
                  {translateZone(band.zone, lang)} · {band.count}
                </span>
              </div>
            )
          })}

          {zoneList.map((zone) => {
            const rect = zoneRectOf(zone)
            const fullH = (rect.h ?? 100) >= 99.5
            const count = (tables || []).filter((table) => (table.zone || 'Main') === zone.name).length
            return (
              <div
                key={zone.id}
                onPointerDown={(event) => startZoneDrag(event, zone)}
                onPointerMove={moveZoneDrag}
                onPointerUp={endZoneDrag}
                onPointerCancel={endZoneDrag}
                className={`absolute rounded-2xl border-2 border-dashed ${zoneDrag?.id === zone.id || zoneResize?.id === zone.id ? 'border-orange-400 bg-orange-50/50' : 'border-zinc-400/70 bg-white/40'} ${arrange ? 'cursor-move' : 'pointer-events-none border-zinc-300/70'}`}
                style={{
                  left: `${rect.x}%`,
                  width: `${rect.w}%`,
                  ...(fullH
                    ? { top: '1.5rem', bottom: '1.5rem' }
                    : { top: `${rect.y}%`, height: `${rect.h}%` }),
                }}
              >
                <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap">
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => { if (arrange) setZoneEditor(zone) }}
                    className={`rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm ${arrange ? 'pointer-events-auto cursor-pointer ring-1 ring-orange-300 hover:text-orange-600' : ''}`}
                  >
                    {translateZone(zone.name, lang)} · {count}{arrange ? ' ✎' : ''}
                  </button>
                </div>
                {arrange && (
                  <button
                    type="button"
                    aria-label={`Resize zone ${zone.name}`}
                    onPointerDown={(event) => startZoneResize(event, zone)}
                    onPointerMove={moveZoneResize}
                    onPointerUp={endZoneResize}
                    onPointerCancel={endZoneResize}
                    className="absolute bottom-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-zinc-500 shadow-md ring-1 ring-zinc-300/80 hover:bg-orange-500 hover:text-white"
                  >
                    ⤢
                  </button>
                )}
              </div>
            )
          })}

          <div className="pointer-events-none absolute left-5 top-4 rounded-xl border border-zinc-200 bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
            {dict.nav?.kitchen || 'Kitchen'}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#fffdf9] px-3 text-[10px] font-semibold text-zinc-500">
            {lang === 'km' ? 'ច្រកចូល' : lang === 'zh' ? '入口' : 'Entrance'}
          </div>

          {(tables || []).map((table) => {
            const { x, y } = posOf(table)
            const scale = scaleOf(table)
            const shape = table.seats >= 6 ? 'rounded-2xl' : table.seats === 2 ? 'rounded-full' : 'rounded-xl'
            const meta = TABLE_STATUS_META[table.status] || TABLE_STATUS_META.free
            const count = itemCount(table)
            const dragging = drag?.id === table.id
            const resizing = resize?.id === table.id
            const showBill = table.status === 'billed' || table.status === 'billing'
            const showSelf = Boolean(table.selfSeated)
            // The shipped hover/drag transforms stay untouched while the
            // tile is at its default size; a custom scale takes over the
            // transform entirely (inline style beats any hover class).
            const usesInlineTransform = scale !== 1
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
                  style={usesInlineTransform ? { transform: `scale(${scale})` } : undefined}
                  className={`group relative flex h-12 w-16 flex-col items-center justify-center ${shape} text-sm font-bold shadow-md ring-4 ring-white/80 ${toneClass(table.status)} ${dragging ? 'ring-orange-400' : ''} ${!arrange && !usesInlineTransform ? 'hover:-translate-y-0.5 hover:scale-105' : ''} ${arrange ? 'cursor-grab' : ''}`}
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
                {arrange && (
                  <button
                    type="button"
                    aria-label={`Resize ${table.name}`}
                    onPointerDown={(event) => startTileResize(event, table)}
                    onPointerMove={moveTileResize}
                    onPointerUp={endTileResize}
                    onPointerCancel={endTileResize}
                    className="absolute z-20 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-zinc-500 shadow-md ring-1 ring-zinc-300/80 hover:bg-orange-500 hover:text-white"
                    style={{
                      left: `${(TILE_W * (scale + 1)) / 2 - 10}px`,
                      top: `${(TILE_H * (scale + 1)) / 2 - 10}px`,
                      ...(resizing ? { background: 'rgb(249 115 22)', color: 'white' } : {}),
                    }}
                  >
                    ⤢
                  </button>
                )}
                <span className="pointer-events-none mt-1 flex items-center justify-center gap-1">
                  <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 shadow-sm">{table.seats} {f.seats || 'seats'}</span>
                </span>
              </div>
            )
          })}

          {arrange && (
            <button
              type="button"
              aria-label="Resize room"
              title="Drag to grow the room · overflow tables sit outside the viewport, pan to reach them"
              onPointerDown={startRoomResize}
              onPointerMove={moveRoomResize}
              onPointerUp={endRoomResize}
              onPointerCancel={endRoomResize}
              className="absolute bottom-2 right-2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-xs font-black text-white shadow-lg ring-2 ring-white hover:bg-orange-600"
            >
              ⤡
            </button>
          )}
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

      {zoneEditor && (
        <ZoneEditorModal
          zone={zoneEditor}
          zoneCount={zoneList.length}
          onClose={() => setZoneEditor(null)}
        />
      )}
    </section>
  )
}


export { FloorMap }
