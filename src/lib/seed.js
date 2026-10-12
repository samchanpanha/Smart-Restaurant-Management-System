// ─── Restora seed data ────────────────────────────────────────────
// Realistic Friday-dinner numbers per spec Task 8 Step 5:
// avg check ~$48 · ticket target 18:00 · food cost ~30% vs 32% cap ·
// Table 14 is a 4-top seated 22 min · Burger $16 / plate $4.10 / 74% ·
// Salmon 86'd mid-service.

const now = () => Date.now()
const minAgo = (m) => new Date(now() - m * 60000).toISOString()

export function buildSeed() {
  // ─── Inventory (lastCost drives every plate cost) ─────────────
  const inventory = [
    { id: 'inv_bun', name: 'Brioche bun', unit: 'each', onHand: 64, par: 40, lastCost: 0.35, vendor: 'Bakery Co', location: 'dry' },
    { id: 'inv_patty', name: 'Beef patty 6oz', unit: 'each', onHand: 48, par: 36, lastCost: 2.25, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_tomato', name: 'Tomato', unit: 'each', onHand: 30, par: 20, lastCost: 0.4, vendor: 'Fresh Farms', location: 'walk_in' },
    { id: 'inv_lettuce', name: 'Lettuce portion', unit: 'portion', onHand: 40, par: 24, lastCost: 0.25, vendor: 'Fresh Farms', location: 'walk_in' },
    { id: 'inv_cheese', name: 'Cheddar slice', unit: 'slice', onHand: 72, par: 48, lastCost: 0.45, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_fries', name: 'Fries portion', unit: 'portion', onHand: 36, par: 30, lastCost: 0.6, vendor: 'Fresh Farms', location: 'dry' },
    { id: 'inv_salmon', name: 'Salmon fillet', unit: 'each', onHand: 0, par: 12, lastCost: 5.8, vendor: 'Harbor Fish', location: 'walk_in' },
    { id: 'inv_chicken', name: 'Chicken breast', unit: 'each', onHand: 22, par: 18, lastCost: 2.9, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_pasta', name: 'Pasta portion', unit: 'portion', onHand: 40, par: 20, lastCost: 0.8, vendor: 'Dry Goods Co', location: 'dry' },
    { id: 'inv_cream', name: 'Cream cup', unit: 'cup', onHand: 18, par: 12, lastCost: 0.9, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_saladmix', name: 'Salad mix', unit: 'portion', onHand: 26, par: 20, lastCost: 1.1, vendor: 'Fresh Farms', location: 'walk_in' },
    { id: 'inv_dressing', name: 'Dressing cup', unit: 'cup', onHand: 30, par: 16, lastCost: 0.35, vendor: 'Dry Goods Co', location: 'walk_in' },
    { id: 'inv_wings', name: 'Wings portion', unit: 'portion', onHand: 20, par: 16, lastCost: 2.4, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_steak', name: 'Ribeye 10oz', unit: 'each', onHand: 10, par: 8, lastCost: 8.5, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_cake', name: 'Chocolate cake slice', unit: 'slice', onHand: 12, par: 8, lastCost: 2.1, vendor: 'Bakery Co', location: 'dry' },
    { id: 'inv_icecream', name: 'Ice cream scoops', unit: 'scoop', onHand: 40, par: 24, lastCost: 0.75, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_soda', name: 'Soda can', unit: 'can', onHand: 96, par: 48, lastCost: 0.45, vendor: 'BevCo', location: 'dry' },
    { id: 'inv_coffee', name: 'Coffee portion', unit: 'portion', onHand: 60, par: 30, lastCost: 0.55, vendor: 'BevCo', location: 'dry' },
  ]

  // ─── Menu + recipes ───────────────────────────────────────────
  const menu = [
    { id: 'm_salad', name: 'House Salad', category: 'Starters', price: 9, station: 'pantry', available: true, substituteId: null,
      modifiers: [{ id: 'dressing', label: 'Dressing', required: true, options: ['Ranch', 'Vinaigrette', 'Blue cheese'] }] },
    { id: 'm_wings', name: 'Grill Wings', category: 'Starters', price: 12, station: 'grill', available: true, substituteId: null,
      modifiers: [{ id: 'sauce', label: 'Sauce', required: true, options: ['Buffalo', 'BBQ', 'Garlic parm'] }] },
    { id: 'm_soup', name: 'Soup of the Day', category: 'Starters', price: 7, station: 'saute', available: true, substituteId: null, modifiers: [] },
    { id: 'm_burger', name: 'Restora Burger', category: 'Mains', price: 16, station: 'grill', available: true, substituteId: 'm_chickenpasta',
      modifiers: [{ id: 'temp', label: 'Temp', required: true, options: ['Rare', 'Medium rare', 'Medium', 'Well'] }] },
    { id: 'm_salmon', name: 'Grilled Salmon', category: 'Mains', price: 26, station: 'saute', available: false, substituteId: 'm_chickenpasta',
      modifiers: [{ id: 'doneness', label: 'Doneness', required: true, options: ['Medium', 'Well'] }] },
    { id: 'm_chickenpasta', name: 'Chicken Pasta', category: 'Mains', price: 19, station: 'saute', available: true, substituteId: null, modifiers: [] },
    { id: 'm_steak', name: 'Ribeye Plate', category: 'Mains', price: 29, station: 'grill', available: true, substituteId: 'm_burger',
      modifiers: [{ id: 'temp', label: 'Temp', required: true, options: ['Rare', 'Medium rare', 'Medium', 'Well'] }] },
    { id: 'm_fishchips', name: 'Fish & Chips', category: 'Mains', price: 18, station: 'grill', available: true, substituteId: 'm_burger', modifiers: [] },
    { id: 'm_vegbowl', name: 'Garden Bowl', category: 'Mains', price: 14, station: 'pantry', available: true, substituteId: null, modifiers: [] },
    { id: 'm_cake', name: 'Chocolate Cake', category: 'Desserts', price: 8, station: 'dessert', available: true, substituteId: 'm_icecream', modifiers: [] },
    { id: 'm_icecream', name: 'Ice Cream', category: 'Desserts', price: 6, station: 'dessert', available: true, substituteId: null, modifiers: [] },
    { id: 'm_soda', name: 'Soda', category: 'Drinks', price: 3, station: 'pantry', available: true, substituteId: null, modifiers: [] },
    { id: 'm_coffee', name: 'Coffee', category: 'Drinks', price: 4, station: 'pantry', available: true, substituteId: null, modifiers: [] },
  ]

  const recipes = {
    m_salad: { id: 'r_salad', yieldPortions: 1, prepNotes: 'Toss to order', ingredients: [
      { inventoryItemId: 'inv_saladmix', qty: 1, unit: 'portion', wastePct: 0.05 },
      { inventoryItemId: 'inv_dressing', qty: 1, unit: 'cup', wastePct: 0 },
      { inventoryItemId: 'inv_tomato', qty: 0.5, unit: 'each', wastePct: 0.1 },
    ]},
    m_wings: { id: 'r_wings', yieldPortions: 1, prepNotes: '8 min grill', ingredients: [
      { inventoryItemId: 'inv_wings', qty: 1, unit: 'portion', wastePct: 0.03 },
    ]},
    m_soup: { id: 'r_soup', yieldPortions: 1, prepNotes: 'From steam table', ingredients: [
      { inventoryItemId: 'inv_cream', qty: 0.5, unit: 'cup', wastePct: 0.05 },
    ]},
    // Plate = 0.35 + 2.25 + 0.5×0.40 + 0.25 + 0.45 + 0.60 = $4.10 → 74% contribution
    m_burger: { id: 'r_burger', yieldPortions: 1, prepNotes: 'Smash, rest 2 min', ingredients: [
      { inventoryItemId: 'inv_bun', qty: 1, unit: 'each', wastePct: 0 },
      { inventoryItemId: 'inv_patty', qty: 1, unit: 'each', wastePct: 0 },
      { inventoryItemId: 'inv_tomato', qty: 0.5, unit: 'each', wastePct: 0 },
      { inventoryItemId: 'inv_lettuce', qty: 1, unit: 'portion', wastePct: 0 },
      { inventoryItemId: 'inv_cheese', qty: 1, unit: 'slice', wastePct: 0 },
      { inventoryItemId: 'inv_fries', qty: 1, unit: 'portion', wastePct: 0 },
    ]},
    m_salmon: { id: 'r_salmon', yieldPortions: 1, prepNotes: 'Skin crisp', ingredients: [
      { inventoryItemId: 'inv_salmon', qty: 1, unit: 'each', wastePct: 0.04 },
      { inventoryItemId: 'inv_saladmix', qty: 0.5, unit: 'portion', wastePct: 0 },
    ]},
    m_chickenpasta: { id: 'r_chickenpasta', yieldPortions: 1, prepNotes: '', ingredients: [
      { inventoryItemId: 'inv_chicken', qty: 1, unit: 'each', wastePct: 0.03 },
      { inventoryItemId: 'inv_pasta', qty: 1, unit: 'portion', wastePct: 0 },
      { inventoryItemId: 'inv_cream', qty: 0.5, unit: 'cup', wastePct: 0 },
    ]},
    m_steak: { id: 'r_steak', yieldPortions: 1, prepNotes: 'Rest 5 min', ingredients: [
      { inventoryItemId: 'inv_steak', qty: 1, unit: 'each', wastePct: 0.05 },
      { inventoryItemId: 'inv_fries', qty: 1, unit: 'portion', wastePct: 0 },
    ]},
    m_fishchips: { id: 'r_fishchips', yieldPortions: 1, prepNotes: '', ingredients: [
      { inventoryItemId: 'inv_salmon', qty: 0.5, unit: 'each', wastePct: 0.05 },
      { inventoryItemId: 'inv_fries', qty: 1, unit: 'portion', wastePct: 0 },
    ]},
    m_vegbowl: { id: 'r_vegbowl', yieldPortions: 1, prepNotes: '', ingredients: [
      { inventoryItemId: 'inv_saladmix', qty: 1, unit: 'portion', wastePct: 0.05 },
      { inventoryItemId: 'inv_tomato', qty: 1, unit: 'each', wastePct: 0.1 },
      { inventoryItemId: 'inv_dressing', qty: 1, unit: 'cup', wastePct: 0 },
    ]},
    m_cake: { id: 'r_cake', yieldPortions: 1, prepNotes: 'Plated', ingredients: [
      { inventoryItemId: 'inv_cake', qty: 1, unit: 'slice', wastePct: 0 },
    ]},
    m_icecream: { id: 'r_icecream', yieldPortions: 1, prepNotes: '2 scoops', ingredients: [
      { inventoryItemId: 'inv_icecream', qty: 2, unit: 'scoop', wastePct: 0 },
    ]},
    m_soda: { id: 'r_soda', yieldPortions: 1, prepNotes: '', ingredients: [
      { inventoryItemId: 'inv_soda', qty: 1, unit: 'can', wastePct: 0 },
    ]},
    m_coffee: { id: 'r_coffee', yieldPortions: 1, prepNotes: '', ingredients: [
      { inventoryItemId: 'inv_coffee', qty: 1, unit: 'portion', wastePct: 0 },
    ]},
  }

  // ─── Floor: 16 tables across 3 zones ────────────────────────────
  const T = (n, seats, zone, status = 'free', extra = {}) => ({
    id: `t${String(n).padStart(2, '0')}`,
    name: `Table ${n}`,
    seats,
    zone,
    status,
    currentCheckId: null,
    seatedAt: null,
    partySize: null,
    targetTurnMinutes: seats <= 2 ? 35 : seats <= 4 ? 45 : 60,
    ...extra,
  })

  const tables = [
    T(1, 2, 'Bar'), T(2, 2, 'Bar'),
    T(3, 4, 'Bar', 'ordered', { currentCheckId: 'o_seed_3', seatedAt: minAgo(31), partySize: 3 }),
    T(4, 4, 'Bar'),
    T(5, 2, 'Main'), T(6, 4, 'Main'),
    T(7, 4, 'Main', 'ordered', { currentCheckId: 'o_seed_7', seatedAt: minAgo(14), partySize: 2 }),
    T(8, 6, 'Main', 'seated', { seatedAt: minAgo(6), partySize: 5 }),
    T(9, 4, 'Main', 'billed', { currentCheckId: 'o_seed_9', seatedAt: minAgo(52), partySize: 4 }),
    T(10, 2, 'Main', 'dirty'),
    T(11, 4, 'Patio'), T(12, 4, 'Patio', 'reserved'),
    T(13, 6, 'Patio'),
    // Hero table from the spec: 4-top, seated 22 min
    T(14, 4, 'Patio', 'seated', { seatedAt: minAgo(22), partySize: 3 }),
    T(15, 2, 'Patio'), T(16, 6, 'Patio', 'dirty'),
  ]

  // ─── Reservations + waitlist ───────────────────────────────────
  const reservations = [
    { id: 'res_1', name: 'Carter party', partySize: 4, time: minAgo(-45), tableId: 't12', status: 'booked', notes: 'Window if free', source: 'phone' },
    { id: 'res_2', name: 'Nguyen party', partySize: 2, time: minAgo(-20), tableId: null, status: 'booked', notes: '', source: 'online' },
    { id: 'res_3', name: 'Lopez party', partySize: 6, time: minAgo(-90), tableId: null, status: 'booked', notes: 'Birthday', source: 'phone' },
  ]
  const waitlist = [
    { id: 'wl_1', name: 'Walk-in · Kim', partySize: 3, quotedWaitMin: 20, addedAt: minAgo(8) },
  ]

  // ─── Orders ────────────────────────────────────────────────────
  const orders = [
    // Table 3: mid-prep ticket, grill working it (fired 9 min ago)
    {
      id: 'o_seed_3', tableId: 't03', type: 'dine_in', serverId: 'server', status: 'in_prep',
      createdAt: minAgo(28), sentAt: minAgo(9), paidAt: null, voidReason: null, compTotal: 0,
      items: [
        { id: 'o3_i1', menuItemId: 'm_burger', qty: 2, modifiers: [{ id: 'temp', value: 'Medium' }], station: 'grill', status: 'fired', course: 'main', notes: '', firedAt: minAgo(9), recipeSnapshot: null },
        { id: 'o3_i2', menuItemId: 'm_salad', qty: 1, modifiers: [{ id: 'dressing', value: 'Ranch' }], station: 'pantry', status: 'bump', course: 'appetizer', notes: '', firedAt: minAgo(9), recipeSnapshot: null },
        { id: 'o3_i3', menuItemId: 'm_soda', qty: 2, modifiers: [], station: 'pantry', status: 'bump', course: 'main', notes: '', firedAt: minAgo(9), recipeSnapshot: null },
      ],
    },
    // Table 7: just sent, undo window visible on first load (sent seconds ago)
    {
      id: 'o_seed_7', tableId: 't07', type: 'dine_in', serverId: 'server', status: 'sent',
      createdAt: minAgo(12), sentAt: new Date(now() - 4000).toISOString(), paidAt: null, voidReason: null, compTotal: 0,
      items: [
        { id: 'o7_i1', menuItemId: 'm_chickenpasta', qty: 1, modifiers: [], station: 'saute', status: 'fired', course: 'main', notes: '', firedAt: new Date(now() - 4000).toISOString(), recipeSnapshot: null },
        { id: 'o7_i2', menuItemId: 'm_soup', qty: 1, modifiers: [], station: 'saute', status: 'fired', course: 'appetizer', notes: '', firedAt: new Date(now() - 4000).toISOString(), recipeSnapshot: null },
      ],
    },
    // Table 9: served, awaiting payment
    {
      id: 'o_seed_9', tableId: 't09', type: 'dine_in', serverId: 'server', status: 'served',
      createdAt: minAgo(50), sentAt: minAgo(44), paidAt: null, voidReason: null, compTotal: 0,
      items: [
        { id: 'o9_i1', menuItemId: 'm_steak', qty: 2, modifiers: [{ id: 'temp', value: 'Medium rare' }], station: 'grill', status: 'bump', course: 'main', notes: '', firedAt: minAgo(44), recipeSnapshot: null },
        { id: 'o9_i2', menuItemId: 'm_cake', qty: 1, modifiers: [], station: 'dessert', status: 'bump', course: 'dessert', notes: '', firedAt: minAgo(20), recipeSnapshot: null },
        { id: 'o9_i3', menuItemId: 'm_coffee', qty: 2, modifiers: [], station: 'pantry', status: 'bump', course: 'dessert', notes: '', firedAt: minAgo(20), recipeSnapshot: null },
      ],
    },
  ]

  // Earlier paid checks tonight (avg check ≈ $48)
  const paidSeed = [
    { total: 52, covers: 2, items: [['m_burger', 2], ['m_soda', 2], ['m_icecream', 1]], min: 175 },
    { total: 44, covers: 2, items: [['m_chickenpasta', 2], ['m_coffee', 2]], min: 160 },
    { total: 61, covers: 4, items: [['m_steak', 1], ['m_burger', 1], ['m_salad', 2], ['m_soda', 4]], min: 140 },
    { total: 38, covers: 2, items: [['m_fishchips', 2], ['m_soda', 2]], min: 120 },
    { total: 47, covers: 3, items: [['m_burger', 1], ['m_vegbowl', 1], ['m_wings', 1], ['m_soda', 3]], min: 100 },
    { total: 55, covers: 4, items: [['m_chickenpasta', 2], ['m_soup', 2], ['m_cake', 2]], min: 80 },
    { total: 42, covers: 2, items: [['m_steak', 1], ['m_salad', 1], ['m_coffee', 2]], min: 65 },
    { total: 49, covers: 3, items: [['m_burger', 2], ['m_wings', 1], ['m_soda', 3]], min: 50 },
  ]
  paidSeed.forEach((p, i) => {
    orders.push({
      id: `o_paid_${i + 1}`,
      tableId: null,
      type: 'dine_in',
      serverId: 'server',
      status: 'paid',
      createdAt: minAgo(p.min + 25),
      sentAt: minAgo(p.min + 22),
      paidAt: minAgo(p.min),
      voidReason: null,
      compTotal: 0,
      covers: p.covers,
      total: p.total,
      items: p.items.map(([menuItemId, qty], j) => ({
        id: `op${i}_${j}`, menuItemId, qty, modifiers: [],
        station: 'expo', status: 'bump', course: 'main', notes: '',
        firedAt: minAgo(p.min + 22), recipeSnapshot: null,
      })),
    })
  })

  // Turn history for host wait quotes (partySize → minutes)
  const turnHistory = [
    { partySize: 2, minutes: 34 }, { partySize: 2, minutes: 38 },
    { partySize: 3, minutes: 44 }, { partySize: 3, minutes: 47 },
    { partySize: 4, minutes: 46 }, { partySize: 4, minutes: 52 },
    { partySize: 5, minutes: 58 }, { partySize: 6, minutes: 62 },
  ]

  // Last 7 days daily sales (for sparkline + food-cost trend)
  const salesHistory = [
    { day: 'Thu', sales: 2140, foodCostPct: 0.312 },
    { day: 'Fri', sales: 3280, foodCostPct: 0.298 },
    { day: 'Sat', sales: 3615, foodCostPct: 0.305 },
    { day: 'Sun', sales: 2490, foodCostPct: 0.289 },
    { day: 'Mon', sales: 1180, foodCostPct: 0.296 },
    { day: 'Tue', sales: 1425, foodCostPct: 0.311 },
    { day: 'Wed', sales: 1690, foodCostPct: 0.304 },
  ]

  const wasteLog = [
    { id: 'w_1', inventoryItemId: 'inv_lettuce', qty: 4, reason: 'spoil', at: minAgo(300), by: 'closer' },
  ]
  const invoiceLog = [
    { id: 'invlog_1', vendor: 'Harbor Fish', at: minAgo(1440), lines: [{ inventoryItemId: 'inv_salmon', qty: 12, unitCost: 5.8 }] },
  ]

  return {
    version: 1,
    tables,
    reservations,
    waitlist,
    menu,
    recipes,
    inventory,
    orders,
    wasteLog,
    invoiceLog,
    turnHistory,
    salesHistory,
    dismissedAlerts: [],
    // pendingUndo: { orderId, sentAt, expiresAt } while 15s undo is live
    pendingUndo: null,
    // recalls: { itemKey: expiresAt } for 60s KDS recall
    recalls: {},
    settings: {
      restaurantName: 'Restora · Demo House',
      targetTurnMinutes: 45,
      ticketMinutes: 18,
      foodCostCap: 0.32,
      rushHour: 18,
      taxPct: 0.0875,
      servicePct: 0,
    },
    meta: { seededAt: new Date(now()).toISOString() },
  }
}
