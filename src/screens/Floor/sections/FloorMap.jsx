import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { Button, EmptyState } from '../../../components/ui'
import { TABLE_STATUS_META, TARGETS } from '../../../lib/constants'
import { translateTableName, translateTableStatus, translateZone, useI18n } from '../../../lib/i18n'
import { formatClock, minutesBetween } from '../../../lib/models'
import { useNow, useRestora } from '../../../lib/store'
import { FloorToolbar } from './FloorToolbar.jsx'
import { ZoneEditorModal } from './ZoneEditorModal.jsx'
import { SNAP, MIN_SCALE, MAX_SCALE, toneClass, clampPct, snapPct, zoneBands } from '../shared.js'

// Tile geometry in px (w-20 h-14 on the button) so the resize knob tracks
// the scaled footprint without inventing a second layout.
const TILE_W = 80
const TILE_H = 56
const SCALE_MIN = 0.75
const SCALE_MAX = 3
const SCALE_STEP = 0.25
const ZONE_MIN = 10

// px a pointer must travel before an armed tile/zone drag becomes a drag.
// Below it the gesture stays available to a second finger (pinch) or a tap.
const DRAG_THRESHOLD = 4

// A turn is "long" once it passes the alert ratio of the table's target.
// Module-level so the filter counter and the tile agree without a clock dep.
const isLongTurn = (table) => {
  if (!table || (table.status !== 'seated' && table.status !== 'ordered') || !table.seatedAt) return false
  const target = Number(table.targetTurnMinutes) || 0
  return target > 0 && minutesBetween(table.seatedAt) / target >= TARGETS.turnAlertRatio
}

// Dirty, waiting on the bill, or running long — the host should look here first.
const needsAttention = (table) => ['dirty', 'cleaning', 'billing', 'billed'].includes(table.status) || isLongTurn(table)

// Live meta line for one tile. The shared 30s clock ticks *here* and nowhere
// else, so elapsed minutes stay fresh without re-rendering the whole plan
// (the KDS rule: isolate every clock read in a leaf).
function TileMeta({ table, seatsLabel }) {
  useNow(30000)
  const occupied = table.status === 'seated' || table.status === 'ordered'
  if (!occupied || !table.seatedAt) {
    return (
      <span className="text-[10px] font-semibold opacity-90">
        {table.seats} {seatsLabel || 'seats'}
      </span>
    )
  }
  const mins = minutesBetween(table.seatedAt)
  const long = isLongTurn(table)
  return (
    <span
      className={`tnum mt-0.5 rounded-full px-1.5 text-[10px] font-bold leading-4 ${
        long ? 'bg-[var(--surface)] text-[var(--danger)]' : 'bg-black/25 text-white'
      }`}
    >
      {table.partySize ? `${table.partySize}p · ` : ''}{mins}m
    </span>
  )
}

// Room pixels per axis. 0 means auto-fit; the steppers land on 50s.
const ROOM_MIN_W = 600
const ROOM_MAX_W = 3000
const ROOM_MIN_H = 400
const ROOM_MAX_H = 1800
const ROOM_STEP = 50

const scaleClamp = (value) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(Number(value) * 4) / 4))
const roomClampW = (value) => Math.min(ROOM_MAX_W, Math.max(ROOM_MIN_W, Math.round(Number(value) / ROOM_STEP) * ROOM_STEP))
const roomClampH = (value) => Math.min(ROOM_MAX_H, Math.max(ROOM_MIN_H, Math.round(Number(value) / ROOM_STEP) * ROOM_STEP))

function FloorMap({
  tables,
  orders,
  onOpen,
  floorZones,
  floor,
  reservations = [],
  filter = 'all',
  onFilterChange,
  onAddTable,
  nextFree = null,
}) {
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
  // Live pointers on the viewport: two of them are a pinch (zoom + pan),
  // one is a background drag. The map never swallows page scroll — see the
  // wheel effect and the touch-action class on the viewport.
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null) // { dist, z0, p0x, p0y } — gesture snapshot
  // A tile/zone drag arms on pointerdown but only activates after the pointer
  // actually moves, so a second finger can still turn the gesture into a pinch.
  const tileDragIntentRef = useRef(null)
  const zoneDragIntentRef = useRef(null)
  // Mirrored into a ref for native pointer math (drag deltas read it
  // outside the render cycle).
  const zoomRef = useRef(1)
  const arrangeRef = useRef(false)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  useEffect(() => {
    arrangeRef.current = arrange
  }, [arrange])
  useEffect(() => {
    const pointers = pointersRef.current
    return () => {
      pointers.clear()
      pinchRef.current = null
    }
  }, [])

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

  // The soonest booked reservation per table — the tile wears a small ◷ so a
  // host can see the room is spoken for before it fills.
  const reservationsByTable = useMemo(() => {
    const map = new Map()
    for (const booking of reservations || []) {
      if (!booking || booking.status !== 'booked' || !booking.tableId) continue
      const current = map.get(booking.tableId)
      if (!current || new Date(booking.time) < new Date(current.time)) map.set(booking.tableId, booking)
    }
    return map
  }, [reservations])

  // Filter values: 'all' | 'attention' | 'z:<zone name>' | 's:<status>'.
  const matchesFilter = (table) => {
    if (filter === 'all') return true
    if (filter === 'attention') return needsAttention(table)
    if (filter === 'occupied') return ['seated', 'ordered', 'billed', 'billing', 'occupied'].includes(table.status)
    if (filter.startsWith('z:')) return (table.zone || 'Main') === filter.slice(2)
    if (filter.startsWith('s:')) return table.status === filter.slice(2)
    return true
  }

  const counts = useMemo(() => {
    const byStatus = {}
    const zoneCounts = new Map()
    let attention = 0
    let dimmed = 0
    for (const table of tables || []) {
      byStatus[table.status] = (byStatus[table.status] || 0) + 1
      const zoneName = table.zone || 'Main'
      zoneCounts.set(zoneName, (zoneCounts.get(zoneName) || 0) + 1)
      if (needsAttention(table)) attention += 1
      if (filter !== 'all') {
        const match = filter.startsWith('z:')
          ? zoneName === filter.slice(2)
          : filter.startsWith('s:')
            ? table.status === filter.slice(2)
            : filter === 'occupied'
              ? ['seated', 'ordered', 'billed', 'billing', 'occupied'].includes(table.status)
              : needsAttention(table)
        if (!match) dimmed += 1
      }
    }
    return {
      total: (tables || []).length,
      attention,
      dimmed,
      byStatus,
      zones: zoneList.map((zone) => ({ id: zone.id, name: zone.name, count: zoneCounts.get(zone.name) || 0 })),
    }
  }, [tables, zoneList, filter])

  // Frame one percent-rect of the floor in the viewport (zone chips).
  function focusRect(rect) {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const bounds = viewport.getBoundingClientRect()
    const vw = viewport.clientWidth || bounds.width
    const vh = viewport.clientHeight || bounds.height
    const cw = content.offsetWidth || vw
    const ch = content.offsetHeight || vh
    if (!(cw > 0) || !(ch > 0) || !(vw > 0) || !(vh > 0)) return
    const w = Math.max(Number(rect.w) || 0, 1)
    const h = Math.max(Number(rect.h) || 0, 1)
    const nextZoom = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.min(vw / ((w / 100) * cw), vh / ((h / 100) * ch)) * 0.9),
    )
    const cxRel = (((Number(rect.x) || 0) + w / 2) / 100 - 0.5) * cw
    const cyRel = (((Number(rect.y) || 0) + h / 2) / 100 - 0.5) * ch
    setZoom(nextZoom)
    setPan({ x: -cxRel * nextZoom, y: -cyRel * nextZoom })
  }

  // Choosing a zone chip reframes the room on that zone; other filters leave
  // the current view alone (the user is already looking at the right place).
  useEffect(() => {
    if (!filter.startsWith('z:')) return
    const zone = zoneList.find((entry) => entry.name === filter.slice(2))
    if (zone) focusRect(zone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

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
    // Deliberately no stopPropagation: the viewport still has to see this
    // pointer so a second finger can turn the gesture into a pinch. The drag
    // arms here and only activates once the pointer actually moves.
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    tileDragIntentRef.current = {
      id: table.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left - rect.width / 2,
      offsetY: event.clientY - rect.top - rect.height / 2,
      node: event.currentTarget,
      active: false,
    }
  }

  function moveTileDrag(event) {
    const intent = tileDragIntentRef.current
    if (!intent || intent.pointerId !== event.pointerId) return
    if (pinchRef.current) {
      tileDragIntentRef.current = null
      return
    }
    if (!intent.active) {
      if (Math.hypot(event.clientX - intent.startX, event.clientY - intent.startY) < DRAG_THRESHOLD) return
      intent.active = true
      intent.node.setPointerCapture?.(event.pointerId)
      dragRef.current = intent
    }
    const point = toPct(event.clientX - intent.offsetX, event.clientY - intent.offsetY)
    setDrag({ id: intent.id, x: snapPct(point.x), y: snapPct(point.y) })
  }

  function endTileDrag(event) {
    const intent = tileDragIntentRef.current
    if (!intent || (event && intent.pointerId !== event.pointerId)) return
    tileDragIntentRef.current = null
    dragRef.current = null
    // A tap, not a drag: the tile stays exactly where it was.
    if (!intent.active) return
    const id = intent.id
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

  // Zone rectangles: drag the body to move, the SE grip to resize. Like the
  // tiles, the body drag arms first and activates on movement so a pinch that
  // starts over a zone still works.
  function startZoneDrag(event, zone) {
    if (!arrange) return
    event.preventDefault()
    const rectScreen = event.currentTarget.getBoundingClientRect()
    const fullH = (zone.h ?? 100) >= 99.5
    const w = rectScreen.width || 1
    const h = rectScreen.height || 1
    zoneDragIntentRef.current = {
      id: zone.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: Number.isFinite(Number(zone.x)) ? Number(zone.x) : 0,
      y: Number.isFinite(Number(zone.y)) ? Number(zone.y) : 0,
      fullH,
      offXPct: ((event.clientX - rectScreen.left) / w) * (zone.w || 1) || 0,
      offYPct: fullH ? undefined : ((event.clientY - rectScreen.top) / h) * (zone.h || 1) || 0,
      node: event.currentTarget,
      active: false,
    }
  }

  function moveZoneDrag(event) {
    const intent = zoneDragIntentRef.current
    if (!intent || intent.pointerId !== event.pointerId) return
    if (pinchRef.current) {
      zoneDragIntentRef.current = null
      return
    }
    if (!intent.active) {
      if (Math.hypot(event.clientX - intent.startX, event.clientY - intent.startY) < DRAG_THRESHOLD) return
      intent.active = true
      intent.node.setPointerCapture?.(event.pointerId)
      zoneDragRef.current = intent
      setZoneDrag({ id: intent.id, x: intent.x, y: intent.y })
      return
    }
    const point = toPct(event.clientX, event.clientY)
    setZoneDrag((current) => {
      if (!current || current.id !== intent.id) return current
      return {
        id: intent.id,
        x: snapPct(point.x - intent.offXPct),
        y: intent.fullH ? current.y : snapPct(point.y - intent.offYPct),
      }
    })
  }

  function endZoneDrag(event) {
    const intent = zoneDragIntentRef.current
    if (!intent || (event && intent.pointerId !== event.pointerId)) return
    zoneDragIntentRef.current = null
    zoneDragRef.current = null
    if (!intent.active) return
    setZoneDrag((current) => {
      if (current && current.id === intent.id) {
        dispatch({ type: 'UPDATE_FLOOR_ZONE', zoneId: intent.id, patch: { rect: { x: current.x, y: current.y } } })
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

  // ── Pan + pinch ──────────────────────────────────────────────────────
  // The viewport owns two gestures: one finger drags the room, two fingers
  // pinch-zoom around their midpoint (and pan with it). Both write the same
  // `pan`/`zoom` pair the buttons and Fit use.
  function viewportCenter() {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }

  function startPinch() {
    const points = [...pointersRef.current.values()]
    const center = viewportCenter()
    if (points.length < 2 || !center) return
    const [a, b] = points
    const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y))
    const ux = (a.x + b.x) / 2 - center.cx
    const uy = (a.y + b.y) / 2 - center.cy
    const current = zoomRef.current || 1
    pinchRef.current = {
      dist,
      z0: current,
      // The floor point under the finger midpoint — held still for the gesture.
      p0x: (ux - pan.x) / current,
      p0y: (uy - pan.y) / current,
    }
    // A pinch beats any armed tile/zone drag and the background pan.
    panRef.current = null
    tileDragIntentRef.current = null
    zoneDragIntentRef.current = null
  }

  function movePinch() {
    const pinch = pinchRef.current
    const center = viewportCenter()
    const points = [...pointersRef.current.values()]
    if (!pinch || !center || points.length < 2) return
    const [a, b] = points
    const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y))
    const nextZoom = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.z0 * (dist / pinch.dist)))
    const ux = (a.x + b.x) / 2 - center.cx
    const uy = (a.y + b.y) / 2 - center.cy
    setZoom(nextZoom)
    setPan({ x: ux - pinch.p0x * nextZoom, y: uy - pinch.p0y * nextZoom })
  }

  function startPan(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2) {
      startPinch()
      return
    }
    if (pointersRef.current.size > 1) return
    if (dragRef.current || tileResizeRef.current || zoneDragRef.current || zoneResizeRef.current || roomResizeRef.current) return
    // Let tile taps stay taps — capturing here would swallow the click.
    if (event.target.closest?.('button')) return
    panRef.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePan(event) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinchRef.current) {
      movePinch()
      return
    }
    if (!panRef.current) return
    setPan({
      x: panRef.current.ox + (event.clientX - panRef.current.x),
      y: panRef.current.oy + (event.clientY - panRef.current.y),
    })
  }

  function endPan(event) {
    if (event?.pointerId != null) pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    panRef.current = null
  }

  // Double-click / double-tap the empty floor: zoom in on that spot.
  function zoomAtPoint(clientX, clientY, factor) {
    const center = viewportCenter()
    if (!center) return
    const current = zoom || 1
    const nextZoom = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current * factor))
    const ux = clientX - center.cx
    const uy = clientY - center.cy
    setPan({
      x: ux - ((ux - pan.x) / current) * nextZoom,
      y: uy - ((uy - pan.y) / current) * nextZoom,
    })
    setZoom(nextZoom)
  }

  function handleDoubleClick(event) {
    if (arrange || event.target.closest?.('button')) return
    zoomAtPoint(event.clientX, event.clientY, 1.4)
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

  // Wheel zoom lives on a native listener so it can preventDefault — but only
  // when the user asked for it (Ctrl/⌘ + wheel) or is arranging the room.
  // Plain wheel is page scroll: the map must never trap the workspace.
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return undefined
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey && !arrangeRef.current) return
      event.preventDefault()
      setZoom((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value - event.deltaY * 0.0015)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor) => setZoom((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value * factor)))
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  return (
    <section className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <h2 className="text-[var(--fs-h3)] font-bold text-[var(--text-strong)]">
            {lang === 'km' ? 'ប្លង់តុភោជនីយដ្ឋាន' : lang === 'zh' ? '餐厅餐桌平面图' : 'Restaurant floor'}
          </h2>
          <p className="mt-0.5 text-[var(--fs-caption)] text-[var(--text-muted)]">
            {arrange
              ? (lang === 'km' ? 'អូសតុ/តំបន់ដើម្បីរៀបចំ · ប្រើសង្កត់ក្រោមដើម្បីធ្វើឱ្យធំជាង · ច្របាច់ពីរម្រាម ឬ Ctrl+កង់កណ្ដុរដើម្បីពង្រីក · អូសផ្ទៃខាងក្រោយដើម្បីផ្លាស់ទី' : lang === 'zh' ? '拖动餐桌/区域调整布局 · 用角柄缩放 · 双指捏合或 Ctrl+滚轮缩放 · 拖动空白区域平移' : 'Drag tables & zones to arrange · corner grips resize · pinch or Ctrl+wheel to zoom · drag empty space to pan')
              : (lang === 'km' ? 'ស្ថានភាពតុផ្ទាល់ · ចុចលើតុសម្រាប់សកម្មភាព · ចុចពីរដងដើម្បីពង្រីក' : lang === 'zh' ? '实时桌台状态 · 点击餐桌进行操作 · 双击放大' : 'Live table status · tap a table for actions · double-click to zoom in')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {arrange && (
            <div className="flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 shadow-[var(--shadow-sm)]">
              <button type="button" onClick={() => bumpRoom('w', -ROOM_STEP)} aria-label="Room width smaller" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">−</button>
              <span className="tnum min-w-[64px] text-center text-[var(--fs-caption)] font-semibold text-[var(--text)]" title="Room width">
                W {roomDrag ? roomDrag.w : roomW || (lang === 'km' ? 'ស្វ័យប្រវត្តិ' : lang === 'zh' ? '自适应' : 'auto')}
              </span>
              <button type="button" onClick={() => bumpRoom('w', ROOM_STEP)} aria-label="Room width larger" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">+</button>
              <span className="mx-1 h-4 w-px bg-[var(--border)]" />
              <button type="button" onClick={() => bumpRoom('h', -ROOM_STEP)} aria-label="Room height smaller" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">−</button>
              <span className="tnum min-w-[64px] text-center text-[var(--fs-caption)] font-semibold text-[var(--text)]" title="Room height">
                H {roomDrag ? roomDrag.h : roomH || (lang === 'km' ? 'ស្វ័យប្រវត្តិ' : lang === 'zh' ? '自适应' : 'auto')}
              </span>
              <button type="button" onClick={() => bumpRoom('h', ROOM_STEP)} aria-label="Room height larger" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">+</button>
              <span className="mx-1 h-4 w-px bg-[var(--border)]" />
              <button type="button" onClick={fitRoom} className="rounded-[var(--radius-md)] px-2 text-[var(--fs-caption)] font-bold text-[var(--accent)] hover:bg-[var(--accent-soft)]">
                {lang === 'km' ? 'ធ្វើឱ្យសម' : lang === 'zh' ? '适合窗口' : 'Fit'}
              </button>
            </div>
          )}
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1.5 text-[var(--fs-caption)] font-semibold text-[var(--success)]">
            <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            {lang === 'km' ? 'ទិដ្ឋភាពផ្ទាល់' : lang === 'zh' ? '实时视图' : 'Live view'}
          </span>
          {!arrange && nextFree?.table && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--info-soft)] px-3 py-1.5 text-[var(--fs-caption)] font-semibold text-[var(--info)]"
              title={`${translateTableName(nextFree.table.name, lang)} · ${nextFree.table.partySize || nextFree.table.seats} guests · ${nextFree.mins}m to go`}
            >
              <Icon name="clock" size={12} />
              Next free: {translateTableName(nextFree.table.name, lang)} · ~{nextFree.mins}m
            </span>
          )}
          <div className="flex items-center rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-[var(--shadow-sm)]" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">−</button>
            <button type="button" onClick={resetView} aria-label="Reset view" className="tnum min-w-[44px] rounded-[var(--radius-md)] px-1 text-[var(--fs-label)] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">+</button>
          </div>
          <Button
            size="sm"
            variant={arrange ? 'primary' : 'secondary'}
            onClick={() => setArrange((value) => !value)}
            aria-pressed={arrange}
          >
            {arrange
              ? (lang === 'km' ? 'រួចរាល់' : lang === 'zh' ? '完成' : 'Done arranging')
              : (lang === 'km' ? 'រៀបចំប្លង់' : lang === 'zh' ? '排列布局' : 'Arrange layout')}
          </Button>
        </div>
      </div>

      {counts.total > 0 && (
        <FloorToolbar zones={counts.zones} counts={counts} filter={filter} onFilter={onFilterChange} />
      )}

      <div
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
        onDoubleClick={handleDoubleClick}
        className={`relative min-h-[420px] cursor-grab overflow-hidden bg-[var(--surface-sunken)] active:cursor-grabbing ${arrange ? 'touch-none' : 'touch-pan-y'}`}
      >
        {counts.total === 0 && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--surface-sunken)] p-6">
            <EmptyState
              icon="tables"
              title={lang === 'km' ? 'មិនមានតុនៅឡើយទេ' : lang === 'zh' ? '暂无餐桌' : 'No tables yet'}
              sub={lang === 'km'
                ? 'បន្ថែមតុដំបូង រួចអូសវាទៅទីតាំងរបស់វានៅលើប្លង់។'
                : lang === 'zh'
                  ? '添加第一张餐桌，然后在平面图上把它拖到位置。'
                  : 'Add the first table, then drag it into place on the plan.'}
              action={(
                <Button size="md" onClick={() => onAddTable?.()}>
                  {lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table'}
                  {lang !== 'en' && <span className="sr-only"> Add table</span>}
                </Button>
              )}
            />
          </div>
        )}
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
          <div className={`pointer-events-none absolute inset-4 rounded-[28px] border-2 sm:inset-6 ${roomW || roomH ? 'border-[var(--accent)]/50' : 'border-[var(--border-strong)]'}`} />

          {bands.map((band) => {
            const left = clampPct(band.min - 10)
            const right = clampPct(band.max + 10)
            return (
              <div key={`band_${band.zone}`} className="pointer-events-none absolute inset-y-6 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)]/40" style={{ left: `${left}%`, width: `${Math.max(6, right - left)}%` }}>
                <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--surface)]/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
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
                className={`absolute rounded-[var(--radius-xl)] border-2 border-dashed ${zoneDrag?.id === zone.id || zoneResize?.id === zone.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-strong)]/70 bg-[var(--surface)]/40'} ${arrange ? 'cursor-move' : 'pointer-events-none border-[var(--border-subtle)]'}`}
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
                    className={`rounded-full bg-[var(--surface)]/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shadow-[var(--shadow-sm)] ${arrange ? 'pointer-events-auto cursor-pointer ring-1 ring-[var(--accent)]/40 hover:text-[var(--accent)]' : ''}`}
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
                    className="absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] text-[10px] font-black text-[var(--text-muted)] shadow-[var(--shadow-md)] ring-1 ring-[var(--border-strong)] hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)]"
                  >
                    ⤢
                  </button>
                )}
              </div>
            )
          })}

          <div className="pointer-events-none absolute left-5 top-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
            {dict.nav?.kitchen || 'Kitchen'}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-[var(--surface-sunken)] px-3 text-[10px] font-semibold text-[var(--text-muted)]">
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
            const longTurn = isLongTurn(table)
            const showBill = table.status === 'billed' || table.status === 'billing'
            const showSelf = Boolean(table.selfSeated)
            const showMove = Boolean(table.pendingTransfer && table.pendingTransfer.status === 'pending')
            const booking = reservationsByTable.get(table.id)
            const dim = !matchesFilter(table)
            // The shipped hover/drag transforms stay untouched while the
            // tile is at its default size; a custom scale takes over the
            // transform entirely (inline style beats any hover class).
            const usesInlineTransform = scale !== 1
            return (
              <div
                key={table.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 ${dim ? 'opacity-25' : ''}`}
                style={{ left: `${x}%`, top: `${y}%` }}
              >
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
                  className={`group relative flex h-14 w-20 flex-col items-center justify-center ${shape} text-sm font-bold shadow-[var(--shadow-md)] ring-4 ${longTurn ? 'ring-[var(--warning)]' : 'ring-[var(--surface)]/80'} ${toneClass(table.status)} ${dragging ? 'ring-[var(--accent)]' : ''} ${!arrange && !usesInlineTransform ? 'hover:-translate-y-0.5 hover:scale-105' : ''} ${arrange ? 'cursor-grab' : ''}`}
                >
                  <span className="absolute -top-2 left-1/2 h-2 w-5 -translate-x-1/2 rounded-t-full bg-current opacity-30" />
                  <span className="absolute -bottom-2 left-1/2 h-2 w-5 -translate-x-1/2 rounded-b-full bg-current opacity-30" />
                  <span className="max-w-full truncate px-1 leading-none">{table.name.replace('Table ', '')}</span>
                  <TileMeta table={table} seatsLabel={f.seats || 'seats'} />

                  {(showBill || showSelf || showMove || booking || count > 0) && (
                    <span className="absolute -right-2 -top-2 flex items-center gap-0.5">
                      {showMove && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--warning)] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--surface)]" title="Move requested">⇄</span>}
                      {booking && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--info)] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--surface)]" title={`Booked ${formatClock(booking.time)} · ${booking.name}`}>◷</span>}
                      {showSelf && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--info)] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--surface)]" title="Self-seated">S</span>}
                      {showBill && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--warning)] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--surface)]" title="Bill requested">$</span>}
                      {count > 0 && <span className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--text-strong)]/85 px-1 text-[9px] font-bold text-[var(--surface)] ring-2 ring-[var(--surface)]" title={`${count} items on the check`}>{count}</span>}
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
                    className="absolute z-20 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] text-[10px] font-black text-[var(--text-muted)] shadow-[var(--shadow-md)] ring-1 ring-[var(--border-strong)] hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)]"
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
                  <span className="whitespace-nowrap rounded-full bg-[var(--surface)]/90 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
                    {translateTableStatus(table.status, lang) || meta.label}
                  </span>
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
              className="absolute bottom-2 right-2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-black text-[var(--text-on-accent)] shadow-[var(--shadow-lg)] ring-2 ring-[var(--surface)] hover:bg-[var(--accent-hover)]"
            >
              ⤡
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] px-5 py-2.5 text-[var(--fs-caption)] text-[var(--text-subtle)]">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="tables" size={12} />
          {lang === 'km' ? 'ចុចលើតុដើម្បីមើលសកម្មភាព' : lang === 'zh' ? '点击餐桌查看操作' : 'Tap a table for actions'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="swap" size={12} />
          {lang === 'km' ? 'អូសផ្ទៃទំនេរដើម្បីផ្លាស់ទី · Ctrl+កង់ ដើម្បីពង្រីក' : lang === 'zh' ? '拖动空白处平移 · Ctrl+滚轮缩放' : 'Drag empty space to pan · Ctrl+wheel to zoom'}
        </span>
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
