// ─── Restora seed data ────────────────────────────────────────────
// Realistic Friday-dinner numbers per spec Task 8 Step 5:
// avg check ~$48 · ticket target 18:00 · food cost ~30% vs 32% cap ·
// Table 14 is a 4-top seated 22 min · Burger $16 / plate $4.10 / 74% ·
// Salmon 86'd mid-service.

import { defaultSettings, documentNumber } from './settings.js'
import { orderCharges, plateCostFor } from './models.js'
import {
  buildInvoiceDocument, buildPurchaseOrderDocument, buildReceiptDocument,
  buildReportDocument, buildShiftReport, buildTicketDocument,
} from './documents.js'

const now = () => Date.now()
const minAgo = (m) => new Date(now() - m * 60000).toISOString()

// Normalized floor plan (0–100 on both axes): one column per zone — Bar on the
// left, Main through the middle, Patio down the right — matching the demo room.
const TABLE_LAYOUT = {
  t01: [17, 20], t02: [17, 41], t03: [17, 62], t04: [17, 83],
  t05: [50, 14], t06: [50, 28], t07: [50, 42], t08: [50, 56], t09: [50, 70], t10: [50, 84],
  t11: [83, 14], t12: [83, 28], t13: [83, 42], t14: [83, 56], t15: [83, 70], t16: [83, 84],
}

/**
 * File a small, realistic document registry onto a shop so the Documents
 * module (and every print/export path) has something to show on a fresh
 * demo. Uses the same builders the screens do, so numbers, totals, and
 * layouts match what an owner would print live. Returns the documents plus
 * the advanced numbering counters to fold back into settings.
 */
export function attachSeedDocuments(shop) {
  const settings = shop.settings || {}
  const counters = {}
  for (const kind of Object.keys(settings.numbering || {})) counters[kind] = { ...settings.numbering[kind] }

  const assign = (doc, kind, index, issuedBy) => {
    const seq = Math.max(1, Math.trunc(counters[kind]?.next ?? 1))
    const advanced = { ...(counters[kind] || {}), next: seq + 1 }
    counters[kind] = advanced
    return {
      ...doc,
      id: `doc_seed_${kind}_${index}`,
      number: documentNumber({ ...settings, numbering: { ...counters, [kind]: advanced } }, kind, seq),
      meta: { ...(doc.meta || {}), issuedBy, voided: false },
    }
  }

  const orders = shop.orders || []
  const paid = orders.filter((order) => order.status === 'paid')
  const open = orders.find((order) => order.status && order.status !== 'paid' && order.status !== 'void')
  const received = (shop.purchases || []).find((purchase) => purchase.status === 'received')

  const documents = []
  // Receipts for the last few payments (guest-facing).
  paid.slice(-3).forEach((order, i) => {
    documents.push(assign(buildReceiptDocument({ shop, order, settings }), 'receipt', i + 1, 'server'))
  })
  // One invoice for a company/account guest.
  if (paid.length) {
    documents.push(assign(buildInvoiceDocument({ shop, order: paid.at(-1), settings, paymentTermsDays: 14 }), 'invoice', 1, 'owner'))
  }
  // One kitchen ticket.
  if (open) {
    documents.push(assign(buildTicketDocument({ shop, order: open, settings, station: null }), 'ticket', 1, 'kitchen'))
  }
  // One purchase order sent to a vendor. Its number IS the PO number — a
  // purchase document does not consume a registry sequence of its own.
  if (received) {
    const doc = buildPurchaseOrderDocument({ shop, purchase: received, settings })
    documents.push({ ...doc, id: 'doc_seed_purchase_1', meta: { ...(doc.meta || {}), issuedBy: 'owner', voided: false } })
  }
  // One end-of-shift report.
  const report = buildShiftReport(shop, { range: 'tonight', now: now() })
  documents.push(assign(buildReportDocument({ shop, settings, report, range: 'tonight' }), 'report', 1, 'owner'))

  return { documents, numbering: counters }
}

export function buildSeed() {
  // ─── Inventory (lastCost drives every plate cost) ─────────────
  const inventory = [
    { id: 'inv_bun', name: 'Brioche bun', unit: 'each', onHand: 64, par: 40, lastCost: 0.35, vendor: 'Bakery Co', location: 'dry' },
    { id: 'inv_patty', name: 'Beef patty 6oz', unit: 'each', onHand: 48, par: 36, lastCost: 2.25, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_tomato', name: 'Tomato', unit: 'each', onHand: 30, par: 20, lastCost: 0.4, vendor: 'Fresh Farms', location: 'walk_in' },
    // Packs describe how the item is bought; `unit` is how it is counted.
    { id: 'inv_lettuce', name: 'Lettuce portion', unit: 'portion', onHand: 40, par: 24, lastCost: 0.25, vendor: 'Fresh Farms', location: 'walk_in', packs: [{ id: 'case', name: 'Case', qty: 6, of: null }], purchaseUnit: 'case' },
    { id: 'inv_cheese', name: 'Cheddar slice', unit: 'slice', onHand: 72, par: 48, lastCost: 0.45, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_fries', name: 'Fries portion', unit: 'portion', onHand: 36, par: 30, lastCost: 0.6, vendor: 'Fresh Farms', location: 'dry' },
    { id: 'inv_salmon', name: 'Salmon fillet', unit: 'each', onHand: 0, par: 12, lastCost: 5.8, vendor: 'Harbor Fish', location: 'walk_in', packs: [{ id: 'case', name: 'Case', qty: 12, of: null }], purchaseUnit: 'case' },
    { id: 'inv_chicken', name: 'Chicken breast', unit: 'each', onHand: 22, par: 18, lastCost: 2.9, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_pasta', name: 'Pasta portion', unit: 'portion', onHand: 40, par: 20, lastCost: 0.8, vendor: 'Dry Goods Co', location: 'dry' },
    { id: 'inv_cream', name: 'Cream cup', unit: 'cup', onHand: 18, par: 12, lastCost: 0.9, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_saladmix', name: 'Salad mix', unit: 'portion', onHand: 26, par: 20, lastCost: 1.1, vendor: 'Fresh Farms', location: 'walk_in' },
    { id: 'inv_dressing', name: 'Dressing cup', unit: 'cup', onHand: 30, par: 16, lastCost: 0.35, vendor: 'Dry Goods Co', location: 'walk_in' },
    { id: 'inv_wings', name: 'Wings portion', unit: 'portion', onHand: 20, par: 16, lastCost: 2.4, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_steak', name: 'Ribeye 10oz', unit: 'each', onHand: 10, par: 8, lastCost: 8.5, vendor: 'Prime Meats', location: 'walk_in' },
    { id: 'inv_cake', name: 'Chocolate cake slice', unit: 'slice', onHand: 12, par: 8, lastCost: 2.1, vendor: 'Bakery Co', location: 'dry' },
    { id: 'inv_icecream', name: 'Ice cream scoops', unit: 'scoop', onHand: 40, par: 24, lastCost: 0.75, vendor: 'Dairy Direct', location: 'walk_in' },
    { id: 'inv_soda', name: 'Soda can', unit: 'can', onHand: 96, par: 48, lastCost: 0.45, vendor: 'BevCo', location: 'dry', packs: [{ id: 'case', name: 'Case', qty: 24, of: null }], purchaseUnit: 'case' },
    { id: 'inv_coffee', name: 'Coffee portion', unit: 'portion', onHand: 60, par: 30, lastCost: 0.55, vendor: 'BevCo', location: 'dry', packs: [{ id: 'case', name: 'Case', qty: 20, of: null }], purchaseUnit: 'case' },
  ]

  // Food detail per dish: the course it belongs to, when it sells, how hot
  // it is, and a demo photo. Owners edit all of it in Catalog → Products,
  // and the vocabulary behind it lives in Settings → Food & menu.
  const MENU_DETAIL = {
    m_salad: {
      course: 'Appetizer', menuWindow: 'lunch', dietaryTags: ['Vegetarian', 'Gluten-free'],
      imageUrl: '/photos/salad.svg',
      images: ['/photos/salad.svg', '/photos/salad-prep.svg', '/photos/salad-detail.svg'],
    },
    m_wings: {
      course: 'Appetizer', menuWindow: 'dinner', spiceLevel: 'Medium', dietaryTags: ['Spicy'],
      imageUrl: '/photos/wings.svg',
      images: ['/photos/wings.svg', '/photos/wings-prep.svg', '/photos/wings-detail.svg'],
    },
    m_soup: {
      course: 'Appetizer', menuWindow: 'lunch',
      imageUrl: '/photos/soup.svg',
      images: ['/photos/soup.svg', '/photos/soup-prep.svg', '/photos/soup-detail.svg'],
    },
    m_burger: {
      course: 'Main', menuWindow: 'dinner', imageUrl: '/photos/burger.svg',
      images: ['/photos/burger.svg', '/photos/burger-prep.svg', '/photos/burger-detail.svg'],
      allergens: ['Gluten', 'Dairy', 'Sesame'],
    },
    m_salmon: {
      course: 'Main', menuWindow: 'dinner', imageUrl: '/photos/salmon.svg',
      images: ['/photos/salmon.svg', '/photos/salmon-prep.svg', '/photos/salmon-detail.svg'],
    },
    m_chickenpasta: {
      course: 'Main', menuWindow: 'dinner', imageUrl: '/photos/chickenpasta.svg',
      images: ['/photos/chickenpasta.svg', '/photos/chickenpasta-prep.svg', '/photos/chickenpasta-detail.svg'],
    },
    m_steak: {
      course: 'Main', menuWindow: 'dinner', imageUrl: '/photos/steak.svg',
      images: ['/photos/steak.svg', '/photos/steak-prep.svg', '/photos/steak-detail.svg'],
    },
    m_fishchips: {
      course: 'Main', menuWindow: 'dinner', imageUrl: '/photos/fishchips.svg',
      images: ['/photos/fishchips.svg', '/photos/fishchips-prep.svg', '/photos/fishchips-detail.svg'],
    },
    m_vegbowl: {
      course: 'Main', menuWindow: 'lunch', dietaryTags: ['Vegan', 'Dairy-free'],
      imageUrl: '/photos/vegbowl.svg',
      images: ['/photos/vegbowl.svg', '/photos/vegbowl-prep.svg', '/photos/vegbowl-detail.svg'],
    },
    m_cake: {
      course: 'Dessert', menuWindow: 'dinner', imageUrl: '/photos/cake.svg',
      images: ['/photos/cake.svg', '/photos/cake-prep.svg', '/photos/cake-detail.svg'],
    },
    m_icecream: {
      course: 'Dessert', menuWindow: 'dinner', dietaryTags: ['Vegetarian'],
      imageUrl: '/photos/icecream.svg',
      images: ['/photos/icecream.svg', '/photos/icecream-prep.svg', '/photos/icecream-detail.svg'],
    },
    m_soda: {
      course: 'Drink', menuWindow: '', spiceLevel: '',
      imageUrl: '/photos/soda.svg',
      images: ['/photos/soda.svg', '/photos/soda-prep.svg', '/photos/soda-detail.svg'],
    },
    m_coffee: {
      course: 'Drink', menuWindow: '',
      imageUrl: '/photos/coffee.svg',
      images: ['/photos/coffee.svg', '/photos/coffee-prep.svg', '/photos/coffee-detail.svg'],
    },
  }

  // ─── Suppliers ─────────────────────────────────────────────────
  const suppliers = [
    {
      id: 'sup_meats', name: 'Prime Meats', contactName: 'Dana Whitfield', contactRole: 'Account manager',
      email: 'orders@primemeats.example', phone: '+1 (503) 555-0110', website: 'primemeats.example',
      addressLine1: '44 Industrial Way', city: 'Portland', state: 'OR', postalCode: '97210', country: 'United States',
      taxId: 'EIN 91-2201843', paymentTerms: 'net_14', leadTimeDays: 1, minOrderValue: 150, currency: 'USD',
      deliveryDays: ['TUE', 'THU', 'SAT'], categories: ['Proteins'], status: 'active', rating: 5,
      accountNumber: 'PM-4471', notes: 'Best beef in town. Cut sheet confirmed every Thursday by 4pm.',
      createdAt: minAgo(400 * 1440),
    },
    {
      id: 'sup_produce', name: 'Fresh Farms', contactName: 'Luis Ortega', contactRole: 'Route driver lead',
      email: 'route@freshfarms.example', phone: '+1 (503) 555-0142', website: 'freshfarms.example',
      addressLine1: '18 Valley Road', city: 'Hillsboro', state: 'OR', postalCode: '97123', country: 'United States',
      taxId: 'EIN 93-5510092', paymentTerms: 'net_7', leadTimeDays: 1, minOrderValue: 75, currency: 'USD',
      deliveryDays: ['MON', 'WED', 'FRI'], categories: ['Produce'], status: 'active', rating: 4,
      accountNumber: 'FF-1120', notes: 'Two-day max on leafy greens — order Monday for Wednesday.',
      createdAt: minAgo(380 * 1440),
    },
    {
      id: 'sup_dairy', name: 'Dairy Direct', contactName: 'Priya Nair', contactRole: 'Sales',
      email: 'hello@dairydirect.example', phone: '+1 (503) 555-0177', website: 'dairydirect.example',
      addressLine1: '9 Creamery Lane', city: 'Tillamook', state: 'OR', postalCode: '97141', country: 'United States',
      taxId: '', paymentTerms: 'net_30', leadTimeDays: 2, minOrderValue: 100, currency: 'USD',
      deliveryDays: ['WED'], categories: ['Dairy'], status: 'active', rating: 4,
      accountNumber: 'DD-8842', notes: '', createdAt: minAgo(360 * 1440),
    },
    {
      id: 'sup_fish', name: 'Harbor Fish', contactName: 'Kai Lund', contactRole: 'Owner',
      email: 'kai@harborfish.example', phone: '+1 (503) 555-0198', website: 'harborfish.example',
      addressLine1: 'Pier 5, Dock C', city: 'Astoria', state: 'OR', postalCode: '97103', country: 'United States',
      taxId: 'EIN 95-7702311', paymentTerms: 'cod', leadTimeDays: 0, minOrderValue: 0, currency: 'USD',
      deliveryDays: ['TUE', 'FRI'], categories: ['Proteins'], status: 'active', rating: 5,
      accountNumber: 'HF-2201', notes: 'Call before 6am for same-day salmon. Quality decides the special.',
      createdAt: minAgo(300 * 1440),
    },
    {
      id: 'sup_dry', name: 'Dry Goods Co', contactName: 'Marco Bell', contactRole: 'Inside sales',
      email: 'orders@drygoods.example', phone: '+1 (800) 555-0165', website: 'drygoods.example',
      addressLine1: '2200 Warehouse Blvd', city: 'Portland', state: 'OR', postalCode: '97218', country: 'United States',
      taxId: 'EIN 92-1188437', paymentTerms: 'net_30', leadTimeDays: 3, minOrderValue: 200, currency: 'USD',
      deliveryDays: ['THU'], categories: ['Dry goods'], status: 'active', rating: 3,
      accountNumber: 'DG-3310', notes: 'Free freight over $400. Two substitutions last quarter worth watching.',
      createdAt: minAgo(290 * 1440),
    },
    {
      id: 'sup_bev', name: 'BevCo', contactName: 'Sam Tran', contactRole: 'Territory rep',
      email: 'sam@bevco.example', phone: '+1 (503) 555-0121', website: 'bevco.example',
      addressLine1: '77 Bottling Row', city: 'Portland', state: 'OR', postalCode: '97209', country: 'United States',
      taxId: '', paymentTerms: 'net_14', leadTimeDays: 2, minOrderValue: 120, currency: 'USD',
      deliveryDays: ['FRI'], categories: ['Beverages'], status: 'active', rating: 4,
      accountNumber: 'BC-5590', notes: 'Soda cases are deposit-return; count returns at delivery.',
      createdAt: minAgo(240 * 1440),
    },
    {
      id: 'sup_bakery', name: 'Bakery Co', contactName: 'Ines Duarte', contactRole: 'Head baker',
      email: 'wholesale@bakeryco.example', phone: '+1 (503) 555-0154', website: 'bakeryco.example',
      addressLine1: '5 Flour Street', city: 'Portland', state: 'OR', postalCode: '97214', country: 'United States',
      taxId: '', paymentTerms: 'due_on_receipt', leadTimeDays: 1, minOrderValue: 40, currency: 'USD',
      deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], categories: ['Bakery'], status: 'active', rating: 5,
      accountNumber: 'BK-7781', notes: 'Daily 6:30am drop. Standing order: 60 buns, 14 cake slices.',
      createdAt: minAgo(200 * 1440),
    },
  ]

  // ─── Category trees (menu + inventory, with sub-categories) ─────
  const categories = [
    { id: 'cat_starters', kind: 'menu', name: 'Starters', parentId: null, description: 'First bites and shared plates.', station: 'pantry', color: '#f59e0b', sortOrder: 1, active: true },
    { id: 'cat_starters_salads', kind: 'menu', name: 'Salads', parentId: 'cat_starters', description: '', station: 'pantry', color: '', sortOrder: 1, active: true },
    { id: 'cat_starters_small', kind: 'menu', name: 'Small plates', parentId: 'cat_starters', description: 'Wings, soup, and daily bites.', station: 'grill', color: '', sortOrder: 2, active: true },
    { id: 'cat_mains', kind: 'menu', name: 'Mains', parentId: null, description: 'Entrées fired from the grill and sauté.', station: 'grill', color: '#f36a21', sortOrder: 2, active: true },
    { id: 'cat_mains_grill', kind: 'menu', name: 'Grill', parentId: 'cat_mains', description: '', station: 'grill', color: '', sortOrder: 1, active: true },
    { id: 'cat_mains_saute', kind: 'menu', name: 'Sauté', parentId: 'cat_mains', description: '', station: 'saute', color: '', sortOrder: 2, active: true },
    { id: 'cat_mains_bowls', kind: 'menu', name: 'Bowls', parentId: 'cat_mains', description: '', station: 'pantry', color: '', sortOrder: 3, active: true },
    { id: 'cat_desserts', kind: 'menu', name: 'Desserts', parentId: null, description: '', station: 'dessert', color: '#a78bfa', sortOrder: 3, active: true },
    { id: 'cat_desserts_sweets', kind: 'menu', name: 'Cakes & ice cream', parentId: 'cat_desserts', description: '', station: 'dessert', color: '', sortOrder: 1, active: true },
    { id: 'cat_drinks', kind: 'menu', name: 'Drinks', parentId: null, description: '', station: 'pantry', color: '#38bdf8', sortOrder: 4, active: true },
    { id: 'cat_drinks_cold', kind: 'menu', name: 'Cold', parentId: 'cat_drinks', description: '', station: 'pantry', color: '', sortOrder: 1, active: true },
    { id: 'cat_drinks_hot', kind: 'menu', name: 'Hot', parentId: 'cat_drinks', description: '', station: 'pantry', color: '', sortOrder: 2, active: true },
    { id: 'cat_inv_proteins', kind: 'inventory', name: 'Proteins', parentId: null, description: '', station: 'grill', color: '#ef4444', sortOrder: 1, active: true },
    { id: 'cat_inv_seafood', kind: 'inventory', name: 'Seafood', parentId: 'cat_inv_proteins', description: 'Harbor Fish deliveries.', station: 'saute', color: '', sortOrder: 1, active: true },
    { id: 'cat_inv_produce', kind: 'inventory', name: 'Produce', parentId: null, description: '', station: 'pantry', color: '#22c55e', sortOrder: 2, active: true },
    { id: 'cat_inv_dairy', kind: 'inventory', name: 'Dairy', parentId: null, description: '', station: 'pantry', color: '#eab308', sortOrder: 3, active: true },
    { id: 'cat_inv_dry', kind: 'inventory', name: 'Dry goods', parentId: null, description: '', station: 'pantry', color: '#94a3b8', sortOrder: 4, active: true },
    { id: 'cat_inv_beverage', kind: 'inventory', name: 'Beverages', parentId: null, description: '', station: 'pantry', color: '#0ea5e9', sortOrder: 5, active: true },
    { id: 'cat_inv_bakery', kind: 'inventory', name: 'Bakery', parentId: null, description: '', station: 'pantry', color: '#f97316', sortOrder: 6, active: true },
  ]

  // ─── Stock-management metadata per SKU ─────────────────────────
  const SUPPLIER_BY_VENDOR = {
    'Prime Meats': 'sup_meats', 'Fresh Farms': 'sup_produce', 'Dairy Direct': 'sup_dairy',
    'Harbor Fish': 'sup_fish', 'Dry Goods Co': 'sup_dry', 'BevCo': 'sup_bev', 'Bakery Co': 'sup_bakery',
  }
  const INVENTORY_META = {
    inv_bun: { sku: 'SKU-1001', category: 'Bakery', dailyUse: 45 },
    inv_patty: { sku: 'SKU-1002', category: 'Proteins', dailyUse: 32 },
    inv_tomato: { sku: 'SKU-1003', category: 'Produce', dailyUse: 20 },
    inv_lettuce: { sku: 'SKU-1004', category: 'Produce', dailyUse: 18 },
    inv_cheese: { sku: 'SKU-1005', category: 'Dairy', dailyUse: 40 },
    inv_fries: { sku: 'SKU-1006', category: 'Produce', dailyUse: 26 },
    inv_salmon: { sku: 'SKU-1007', category: 'Proteins', subCategory: 'Seafood', dailyUse: 9 },
    inv_chicken: { sku: 'SKU-1008', category: 'Proteins', dailyUse: 16 },
    inv_pasta: { sku: 'SKU-1009', category: 'Dry goods', dailyUse: 14 },
    inv_cream: { sku: 'SKU-1010', category: 'Dairy', dailyUse: 10 },
    inv_saladmix: { sku: 'SKU-1011', category: 'Produce', dailyUse: 14 },
    inv_dressing: { sku: 'SKU-1012', category: 'Dry goods', dailyUse: 12 },
    inv_wings: { sku: 'SKU-1013', category: 'Proteins', dailyUse: 12 },
    inv_steak: { sku: 'SKU-1014', category: 'Proteins', dailyUse: 7 },
    inv_cake: { sku: 'SKU-1015', category: 'Bakery', dailyUse: 8 },
    inv_icecream: { sku: 'SKU-1016', category: 'Dairy', dailyUse: 14 },
    inv_soda: { sku: 'SKU-1017', category: 'Beverages', dailyUse: 52 },
    inv_coffee: { sku: 'SKU-1018', category: 'Beverages', dailyUse: 30 },
  }
  inventory.forEach((item, index) => {
    const meta = INVENTORY_META[item.id] || {}
    // avgCost drifts a cent or two off lastCost so the weighted-average
    // valuation method shows a different (and honest) number.
    const drift = ((index % 5) - 2) * 0.012
    Object.assign(item, {
      sku: meta.sku || `SKU-${2000 + index}`,
      supplierId: SUPPLIER_BY_VENDOR[item.vendor] || null,
      category: meta.category || 'Dry goods',
      subCategory: meta.subCategory || '',
      avgCost: Math.round(item.lastCost * (1 + drift) * 10000) / 10000,
      reorderPoint: item.par,
      dailyUse: meta.dailyUse || 4,
      incoming: 0,
      lot: null,
      expiresOn: null,
      countDueDays: 1 + (index % 7),
      notes: '',
      active: true,
      // Every seeded SKU is stock-tracked; "not counted" is opt-in per item.
      counted: true,
    })
  })

  // ─── Menu + recipes ───────────────────────────────────────────
  const menu = [
    {
      id: 'm_salad', name: 'House Salad', category: 'Starters', price: 9, station: 'pantry', available: true, active: true,
      description: 'Crisp greens, tomato, and your choice of dressing. Tossed to order.',
      dietaryTags: ['Vegetarian'], allergens: ['Varies by dressing choice'], imageUrl: '', sortOrder: 0, substituteId: null,
      modifiers: [{ id: 'dressing', label: 'Dressing', required: true, options: ['Ranch', 'Vinaigrette', 'Blue cheese'] }],
    },
    {
      id: 'm_wings', name: 'Grill Wings', category: 'Starters', price: 12, station: 'grill', available: true, active: true,
      description: 'Grill-fired wings tossed in your choice of sauce.',
      dietaryTags: [], allergens: ['Varies by sauce choice'], imageUrl: '', sortOrder: 1, substituteId: null,
      modifiers: [{ id: 'sauce', label: 'Sauce', required: true, options: ['Buffalo', 'BBQ', 'Garlic parm'] }],
    },
    {
      id: 'm_soup', name: 'Soup of the Day', category: 'Starters', price: 7, station: 'saute', available: true, active: true,
      description: 'A rotating daily soup, prepared in-house. Ask us what is simmering today.',
      dietaryTags: [], allergens: ['Varies by daily recipe'], imageUrl: '', sortOrder: 2, substituteId: null, modifiers: [],
    },
    {
      id: 'm_burger', name: 'Restora Burger', category: 'Mains', price: 16, station: 'grill', available: true, active: true,
      description: 'Smashed beef patty, cheddar, brioche, and fries on the side.',
      dietaryTags: [], allergens: ['Wheat', 'Milk'], imageUrl: '', sortOrder: 3, substituteId: 'm_chickenpasta',
      modifiers: [{ id: 'temp', label: 'Temp', required: true, options: ['Rare', 'Medium rare', 'Medium', 'Well'] }],
    },
    {
      id: 'm_salmon', name: 'Grilled Salmon', category: 'Mains', price: 26, station: 'saute', available: false, active: true,
      description: 'Crisp-skin salmon fillet with seasonal market sides.',
      dietaryTags: [], allergens: ['Fish'], imageUrl: '', sortOrder: 4, substituteId: 'm_chickenpasta',
      modifiers: [{ id: 'doneness', label: 'Doneness', required: true, options: ['Medium', 'Well'] }],
    },
    {
      id: 'm_chickenpasta', name: 'Chicken Pasta', category: 'Mains', price: 19, station: 'saute', available: true, active: true,
      description: 'Grilled chicken over pasta tossed in a creamy sauce.',
      dietaryTags: [], allergens: ['Wheat', 'Milk'], imageUrl: '', sortOrder: 5, substituteId: null, modifiers: [],
    },
    {
      id: 'm_steak', name: 'Ribeye Plate', category: 'Mains', price: 29, station: 'grill', available: true, active: true,
      description: 'Grilled ribeye, rested for five minutes, served with fries.',
      dietaryTags: [], allergens: [], imageUrl: '', sortOrder: 6, substituteId: 'm_burger',
      modifiers: [{ id: 'temp', label: 'Temp', required: true, options: ['Rare', 'Medium rare', 'Medium', 'Well'] }],
    },
    {
      id: 'm_fishchips', name: 'Fish & Chips', category: 'Mains', price: 18, station: 'grill', available: true, active: true,
      description: 'Crisp fish with golden fries and lemon.',
      dietaryTags: [], allergens: ['Fish', 'Wheat'], imageUrl: '', sortOrder: 7, substituteId: 'm_burger', modifiers: [],
    },
    {
      id: 'm_vegbowl', name: 'Garden Bowl', category: 'Mains', price: 14, station: 'pantry', available: true, active: true,
      description: 'A fresh bowl of greens, tomato, and dressing.',
      dietaryTags: ['Vegetarian'], allergens: ['Varies by dressing choice'], imageUrl: '', sortOrder: 8, substituteId: null, modifiers: [],
    },
    {
      id: 'm_cake', name: 'Chocolate Cake', category: 'Desserts', price: 8, station: 'dessert', available: true, active: true,
      description: 'Rich chocolate cake, plated to order.',
      dietaryTags: [], allergens: ['Wheat', 'Milk', 'Egg'], imageUrl: '', sortOrder: 9, substituteId: 'm_icecream', modifiers: [],
    },
    {
      id: 'm_icecream', name: 'Ice Cream', category: 'Desserts', price: 6, station: 'dessert', available: true, active: true,
      description: 'Two scoops of classic ice cream.',
      dietaryTags: ['Vegetarian'], allergens: ['Milk'], imageUrl: '', sortOrder: 10, substituteId: null, modifiers: [],
    },
    {
      id: 'm_soda', name: 'Soda', category: 'Drinks', price: 3, station: 'pantry', available: true, active: true,
      description: 'An ice-cold can of soda.',
      dietaryTags: [], allergens: [], imageUrl: '', sortOrder: 11, substituteId: null, modifiers: [],
    },
    {
      id: 'm_coffee', name: 'Coffee', category: 'Drinks', price: 4, station: 'pantry', available: true, active: true,
      description: 'Freshly brewed dinner coffee.',
      dietaryTags: [], allergens: [], imageUrl: '', sortOrder: 12, substituteId: null, modifiers: [],
    },
  ]

  const MENU_SUBCATEGORY = {
    m_salad: 'Salads', m_wings: 'Small plates', m_soup: 'Small plates',
    m_burger: 'Grill', m_steak: 'Grill', m_fishchips: 'Grill',
    m_salmon: 'Sauté', m_chickenpasta: 'Sauté', m_vegbowl: 'Bowls',
    m_cake: 'Cakes & ice cream', m_icecream: 'Cakes & ice cream',
    m_soda: 'Cold', m_coffee: 'Hot',
  }
  const MENU_SKU = {
    m_salad: 'M-101', m_wings: 'M-102', m_soup: 'M-103', m_burger: 'M-104', m_salmon: 'M-105',
    m_chickenpasta: 'M-106', m_steak: 'M-107', m_fishchips: 'M-108', m_vegbowl: 'M-109',
    m_cake: 'M-110', m_icecream: 'M-111', m_soda: 'M-112', m_coffee: 'M-113',
  }
  menu.forEach((item) => {
    item.subCategory = MENU_SUBCATEGORY[item.id] || ''
    item.sku = MENU_SKU[item.id] || ''
    item.auto86 = false
  })

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
  ].map((table) => (TABLE_LAYOUT[table.id] ? { ...table, posX: TABLE_LAYOUT[table.id][0], posY: TABLE_LAYOUT[table.id][1] } : table))

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

  // Earlier paid checks tonight (avg check ≈ $48 collected)
  const paidSeed = [
    { covers: 2, items: [['m_burger', 2], ['m_soda', 2]], min: 175 },
    { covers: 2, items: [['m_chickenpasta', 1], ['m_burger', 1], ['m_coffee', 1]], min: 160 },
    { covers: 3, items: [['m_burger', 1], ['m_vegbowl', 1], ['m_soda', 2]], min: 140 },
    { covers: 2, items: [['m_steak', 1], ['m_salad', 2]], min: 120 },
    { covers: 2, items: [['m_fishchips', 2]], min: 100 },
    { covers: 3, items: [['m_burger', 1], ['m_wings', 1], ['m_soup', 1], ['m_soda', 1]], min: 80 },
    { covers: 4, items: [['m_chickenpasta', 1], ['m_soup', 1], ['m_cake', 1], ['m_soda', 2]], min: 65 },
    { covers: 2, items: [['m_burger', 1], ['m_wings', 1], ['m_coffee', 2]], min: 50 },
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
      // The money is filled in below, from the lines themselves, so a
      // settled check always agrees with what it actually sold.
      total: 0,
      payMethod: i % 4 === 3 ? 'cash' : 'card',
      tip: 0,
      payments: [],
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

  const mondayOffset = (() => {
    const d = new Date(now())
    const day = d.getDay()
    return day === 0 ? -6 : 1 - day
  })()
  const monday = new Date(new Date(now()).getTime() + mondayOffset * 86400000)
  const dateForDay = (offset) => new Date(monday.getTime() + offset * 86400000).toISOString().slice(0, 10)

  const shifts = [
    { id: 'shf_1', staffName: 'Jordan Lee', role: 'server', date: dateForDay(0), startTime: '10:00', endTime: '16:00', note: 'Floor lunch' },
    { id: 'shf_2', staffName: 'Alex Smith', role: 'server', date: dateForDay(0), startTime: '16:00', endTime: '23:00', note: 'Dinner lead' },
    { id: 'shf_3', staffName: 'Kim Park', role: 'kitchen', date: dateForDay(0), startTime: '09:00', endTime: '17:00', note: 'Kitchen prep & lunch' },
    { id: 'shf_4', staffName: 'Sam Rivera', role: 'kitchen', date: dateForDay(0), startTime: '16:00', endTime: '23:30', note: 'Grill & close' },
    { id: 'shf_5', staffName: 'Jordan Lee', role: 'server', date: dateForDay(1), startTime: '10:00', endTime: '16:00', note: 'Lunch service' },
    { id: 'shf_6', staffName: 'Kim Park', role: 'kitchen', date: dateForDay(1), startTime: '11:00', endTime: '21:00', note: 'All-day lead' },
    { id: 'shf_7', staffName: 'Taylor Morgan', role: 'host', date: dateForDay(1), startTime: '17:00', endTime: '22:00', note: 'Dinner seating' },
    { id: 'shf_8', staffName: 'Alex Smith', role: 'server', date: dateForDay(2), startTime: '11:00', endTime: '20:00', note: 'Floor service' },
    { id: 'shf_9', staffName: 'Sam Rivera', role: 'kitchen', date: dateForDay(2), startTime: '10:00', endTime: '18:00', note: 'Prep & line' },
    { id: 'shf_10', staffName: 'Jordan Lee', role: 'server', date: dateForDay(3), startTime: '16:00', endTime: '23:00', note: 'Dinner rush' },
    { id: 'shf_11', staffName: 'Kim Park', role: 'kitchen', date: dateForDay(3), startTime: '15:00', endTime: '23:00', note: 'Expo & cook' },
    { id: 'shf_12', staffName: 'Jordan Lee', role: 'server', date: dateForDay(4), startTime: '10:00', endTime: '17:00', note: 'Lunch opener' },
    { id: 'shf_13', staffName: 'Alex Smith', role: 'server', date: dateForDay(4), startTime: '16:00', endTime: '24:00', note: 'Weekend dinner rush' },
    { id: 'shf_14', staffName: 'Kim Park', role: 'kitchen', date: dateForDay(4), startTime: '09:00', endTime: '17:00', note: 'Weekend prep' },
    { id: 'shf_15', staffName: 'Sam Rivera', role: 'kitchen', date: dateForDay(4), startTime: '16:00', endTime: '24:00', note: 'Dinner line' },
    { id: 'shf_16', staffName: 'Taylor Morgan', role: 'host', date: dateForDay(4), startTime: '16:30', endTime: '22:30', note: 'Door / Host stand' },
    { id: 'shf_17', staffName: 'Alex Smith', role: 'server', date: dateForDay(5), startTime: '11:00', endTime: '23:00', note: 'Full day' },
    { id: 'shf_18', staffName: 'Kim Park', role: 'kitchen', date: dateForDay(5), startTime: '10:00', endTime: '22:00', note: 'Chef lead' },
    { id: 'shf_19', staffName: 'Taylor Morgan', role: 'host', date: dateForDay(5), startTime: '16:00', endTime: '22:00', note: 'Floor flow' },
    { id: 'shf_20', staffName: 'Jordan Lee', role: 'server', date: dateForDay(6), startTime: '10:00', endTime: '18:00', note: 'Sunday brunch' },
    { id: 'shf_21', staffName: 'Sam Rivera', role: 'kitchen', date: dateForDay(6), startTime: '09:00', endTime: '18:00', note: 'Brunch kitchen' },
  ]
  // ── Buy side: purchases + the movement ledger they write to ───────
  // Two deliveries already received, one order still with the vendor.
  const purchases = [
    {
      id: 'po_seed_1',
      number: `PO-${new Date(now()).getFullYear()}-0098`,
      supplierId: 'sup_fish',
      vendor: 'Harbor Fish',
      reference: 'HF-2291',
      status: 'received',
      note: 'Friday delivery — salmon for the weekend specials.',
      orderedAt: minAgo(3 * 1440),
      expectedAt: minAgo(2 * 1440),
      receivedAt: minAgo(2 * 1440),
      createdBy: 'owner',
      createdAt: minAgo(3 * 1440),
      updatedAt: minAgo(2 * 1440),
      lines: [
        { id: 'po_seed_1_l1', inventoryItemId: 'inv_salmon', name: 'Salmon fillet', unit: 'each', qty: 12, unitCost: 5.8, receivedQty: 12 },
      ],
      tax: 0,
      shipping: 0,
      totals: { subtotal: 69.6, tax: 0, shipping: 0, total: 69.6 },
    },
    {
      id: 'po_seed_2',
      number: `PO-${new Date(now()).getFullYear()}-0099`,
      supplierId: 'sup_meats',
      vendor: 'Prime Meats',
      reference: 'PM-88410',
      status: 'received',
      note: '',
      orderedAt: minAgo(2 * 1440),
      expectedAt: minAgo(2 * 1440),
      receivedAt: minAgo(2 * 1440),
      createdBy: 'owner',
      createdAt: minAgo(2 * 1440),
      updatedAt: minAgo(2 * 1440),
      lines: [
        { id: 'po_seed_2_l1', inventoryItemId: 'inv_steak', name: 'Ribeye steak', unit: 'each', qty: 10, unitCost: 8.5, receivedQty: 10 },
        { id: 'po_seed_2_l2', inventoryItemId: 'inv_patty', name: 'Beef patty 6oz', unit: 'each', qty: 48, unitCost: 2.25, receivedQty: 48 },
      ],
      tax: 0,
      shipping: 0,
      totals: { subtotal: 193, tax: 0, shipping: 0, total: 193 },
    },
    {
      id: 'po_seed_3',
      number: `PO-${new Date(now()).getFullYear()}-0100`,
      supplierId: 'sup_produce',
      vendor: 'Fresh Farms',
      reference: '',
      status: 'ordered',
      note: 'Tomorrow 7am — leaves room for the salad special.',
      orderedAt: minAgo(120),
      expectedAt: minAgo(-840),
      receivedAt: null,
      createdBy: 'owner',
      createdAt: minAgo(140),
      updatedAt: minAgo(120),
      lines: [
        { id: 'po_seed_3_l1', inventoryItemId: 'inv_lettuce', name: 'Lettuce portion', unit: 'case', qty: 4, unitCost: 8.1, receivedQty: 0, packSize: 6 },
        { id: 'po_seed_3_l2', inventoryItemId: 'inv_tomato', name: 'Tomato', unit: 'each', qty: 10, unitCost: 2.4, receivedQty: 0, packSize: 1 },
      ],
      tax: 0,
      shipping: 0,
      totals: { subtotal: 56.4, tax: 0, shipping: 0, total: 56.4 },
    },
  ]

  // The ledger: opening balances, the two receipts above, and the sales the
  // seed orders represent. Signed quantity, costed at the time it moved.
  const buyMovements = [
    {
      id: 'mv_seed_1', at: minAgo(2 * 1440), itemId: 'inv_salmon', name: 'Salmon fillet', unit: 'each',
      kind: 'buy', qty: 12, unitCost: 5.8, value: 69.6, ref: 'po_seed_1', note: 'PO-0098', by: 'owner',
    },
    {
      id: 'mv_seed_2', at: minAgo(2 * 1440), itemId: 'inv_steak', name: 'Ribeye steak', unit: 'each',
      kind: 'buy', qty: 10, unitCost: 8.5, value: 85, ref: 'po_seed_2', note: 'PO-0099', by: 'owner',
    },
    {
      id: 'mv_seed_3', at: minAgo(2 * 1440), itemId: 'inv_patty', name: 'Beef patty 6oz', unit: 'each',
      kind: 'buy', qty: 48, unitCost: 2.25, value: 108, ref: 'po_seed_2', note: 'PO-0099', by: 'owner',
    },
  ]

  // Waste the shift logged, mirrored into the ledger the same way the
  // LOG_WASTE action does it: negative quantity, costed at the time.
  const wasteMovements = wasteLog.map((entry, index) => {
    const item = inventory.find((row) => row.id === entry.inventoryItemId)
    const qty = Math.abs(Number(entry.qty) || 0)
    const unitCost = Number(item?.lastCost) || 0
    return {
      id: `mv_waste_${index + 1}`,
      at: entry.at,
      itemId: entry.inventoryItemId,
      name: item?.name || entry.inventoryItemId,
      unit: item?.unit || '',
      kind: 'waste',
      qty: -qty,
      unitCost,
      value: -Math.round(qty * unitCost * 100) / 100,
      ref: null,
      note: entry.reason || 'waste',
      by: entry.by || 'owner',
    }
  })

  // Opening balances are back-filled from today's count minus what has
  // moved since, so opening + in − out always equals on-hand.
  const movements = reseatOpeningBalances(inventory, [...buyMovements, ...wasteMovements], { at: minAgo(7 * 1440), by: 'owner' })

  const invoiceLog = [
    { id: 'invlog_0', vendor: 'Harbor Fish', at: minAgo(7 * 1440), lines: [{ inventoryItemId: 'inv_salmon', qty: 12, unitCost: 5.18 }] },
    { id: 'invlog_1', vendor: 'Harbor Fish', supplierId: 'sup_fish', purchaseId: 'po_seed_1', reference: 'HF-2291', at: minAgo(2 * 1440), total: 69.6, lines: [{ inventoryItemId: 'inv_salmon', qty: 12, unitCost: 5.8 }] },
    { id: 'invlog_2', vendor: 'Prime Meats', supplierId: 'sup_meats', purchaseId: 'po_seed_2', reference: 'PM-88410', at: minAgo(2 * 1440), total: 193, lines: [{ inventoryItemId: 'inv_steak', qty: 10, unitCost: 8.5 }, { inventoryItemId: 'inv_patty', qty: 48, unitCost: 2.25 }] },
  ]

  const menuWithDetail = menu.map((item) => ({
    course: 'Main',
    menuWindow: '',
    spiceLevel: '',
    ...item,
    ...(MENU_DETAIL[item.id] || {}),
  }))

  const settings = {
    ...defaultSettings('Downtown'),
    restaurantName: 'Restora · Downtown',
    locationShort: 'DT',
    targetTurnMinutes: 45,
    ticketMinutes: 18,
    foodCostCap: 0.32,
    rushHour: 18,
    taxPct: 0.0875,
    servicePct: 0,
  }

  // A settled check carries the money a real settlement would: its own
  // lines priced, plus tax, plus the tip that was collected. A demo whose
  // dashboard and its sales report disagree teaches the wrong thing, so
  // the seed prices the paid checks from the same charge sheet the till
  // and the reports use.
  const seedMenuById = Object.fromEntries(menuWithDetail.map((item) => [item.id, item]))
  for (const order of orders) {
    if (order.status !== 'paid') continue
    const charges = orderCharges(order, seedMenuById, settings)
    const tip = Math.round(charges.subtotal * 0.18 * 100) / 100
    const grandTotal = Math.round((charges.total + tip) * 100) / 100
    order.total = charges.total
    order.tip = tip
    order.payments = [{ method: order.payMethod, amount: grandTotal, at: order.paidAt }]
    order.charges = {
      subtotal: charges.subtotal,
      discount: charges.discount,
      service: charges.service,
      tax: charges.tax,
      delivery: charges.delivery,
      total: charges.total,
      tip,
      grandTotal,
    }
  }

  // Plate cost is recorded when a dish leaves the kitchen. Without this,
  // tomorrow's delivery would silently rewrite yesterday's margins.
  const inventoryById = Object.fromEntries(inventory.map((item) => [item.id, item]))
  const frozenOrders = orders.map((order) => ({
    ...order,
    items: order.items.map((item) => {
      if (item.recipeSnapshot) return item
      const recipe = recipes[item.menuItemId]
      if (!recipe) return item
      return { ...item, recipeSnapshot: { ...recipe, plateCost: plateCostFor(recipe, inventoryById, settings) } }
    }),
  }))

  const seeded = attachSeedDocuments({ orders: frozenOrders, purchases, suppliers, inventory, menu: menuWithDetail, tables, settings, salesHistory, movements })

  return {
    version: 1,
    tables,
    reservations,
    waitlist,
    menu: menuWithDetail,
    recipes,
    inventory,
    orders: frozenOrders,
    shifts,
    wasteLog,
    invoiceLog,
    turnHistory,
    salesHistory,
    dismissedAlerts: [],
    // pendingUndo: { orderId, sentAt, expiresAt } while 15s undo is live
    pendingUndo: null,
    // recalls: { itemKey: expiresAt } for 60s KDS recall
    recalls: {},
    categories,
    suppliers,
    // Issued documents (invoices, receipts, tickets, reports, purchase
    // orders) — the printed-number registry, newest last.
    documents: seeded.documents,
    // Buy side: purchase orders (draft → ordered → received) and the
    // signed stock-movement ledger every report reads.
    purchases,
    movements,
    settings: { ...settings, numbering: seeded.numbering },
    meta: { seededAt: new Date(now()).toISOString() },
  }
}

/**
 * Opening balances are a derived baseline: today's on-hand minus every
 * non-opening movement. That keeps `opening + in − out = on hand` true for
 * any ledger, which is exactly the identity the stock reports check.
 */
export function reseatOpeningBalances(inventory, movements, options = {}) {
  const openings = movements.filter((move) => move.kind === 'opening')
  const rest = movements.filter((move) => move.kind !== 'opening')
  const netByItem = rest.reduce((acc, move) => {
    acc[move.itemId] = (acc[move.itemId] || 0) + (Number(move.qty) || 0)
    return acc
  }, {})
  const at = options.at || openings[0]?.at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const by = options.by || openings[0]?.by || 'owner'
  const rows = []
  for (const item of inventory) {
    const existing = openings.find((move) => move.itemId === item.id)
    const net = netByItem[item.id] || 0
    const back = Math.round((item.onHand - net) * 1000) / 1000
    const unitCost = Number(item.lastCost) || 0
    const openingQty = Math.max(0, back)
    if (existing || openingQty > 0) {
      rows.push({
        id: existing?.id || `mv_open_${item.id}`,
        at: existing?.at || at,
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        kind: 'opening',
        qty: openingQty,
        unitCost,
        value: Math.round(openingQty * unitCost * 100) / 100,
        ref: null,
        note: existing?.note || 'opening count',
        by: existing?.by || by,
      })
    }
    // More moved through this SKU than it could ever have held — the book
    // opened after the stock was already gone. Record the shortfall as a
    // baseline correction so the ledger still adds up to today's count.
    if (back < 0) {
      rows.push({
        id: existing?.id ? `mv_base_${item.id}` : `mv_base_${item.id}`,
        at: at,
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        kind: 'adjust',
        baseline: true,
        qty: Math.round(back * 1000) / 1000,
        unitCost,
        value: Math.round(back * unitCost * 100) / 100,
        ref: null,
        note: 'opening book correction',
        by,
      })
    }
  }
  const sortByTime = (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  return [...rows, ...rest].map((move) => ({ ...move })).sort(sortByTime)
}

// ─── Second store: Riverside ──────────────────────────────────────
// Smaller room (10 tables), softer history, its own stock. Notably it
// HAS salmon — per-store independence you can see on the 86 board.
export function buildSeedRiverside() {
  const base = buildSeed()
  const keep = ['t01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10']
  const remap = Object.fromEntries(keep.map((id, i) => [id, `r${String(i + 1).padStart(2, '0')}`]))

  const tables = base.tables
    .filter((t) => keep.includes(t.id))
    .map((t) => ({ ...t, id: remap[t.id] }))
  const orders = base.orders
    .filter((o) => !o.tableId || keep.includes(o.tableId))
    .map((o) => (o.tableId ? { ...o, tableId: remap[o.tableId] } : o))
    .filter((o, _, arr) => o.status !== 'paid' || arr.filter((x) => x.status === 'paid').indexOf(o) < 5)
  const reservations = base.reservations.slice(0, 2).map((r) => ({
    ...r,
    tableId: r.tableId ? remap[r.tableId] || 'r06' : r.tableId,
  }))
  const waitlist = base.waitlist.slice(0, 1)
  const inventory = base.inventory.map((i) =>
    i.id === 'inv_salmon'
      ? { ...i, onHand: 8 }
      : { ...i, onHand: Math.max(2, Math.round(i.onHand * 0.6)), par: Math.max(4, Math.round(i.par * 0.6)) },
  )
  const menu = base.menu.map((m) => (m.id === 'm_salmon' ? { ...m, available: true } : m))
  const salesHistory = base.salesHistory.map((d) => ({ ...d, sales: Math.round(d.sales * 0.55) }))
  const settings = {
    ...base.settings,
    restaurantName: 'Restora · Riverside',
    locationShort: 'RV',
    numbering: defaultSettings('Riverside').numbering,
  }
  const { documents, numbering } = attachSeedDocuments({
    orders,
    purchases: base.purchases,
    suppliers: base.suppliers,
    inventory,
    menu,
    tables,
    settings,
    salesHistory,
    movements: base.movements,
  })

  return {
    ...base,
    tables,
    orders,
    reservations,
    waitlist,
    inventory,
    menu,
    salesHistory,
    settings: { ...settings, numbering },
    documents,
    meta: { seededAt: new Date(now()).toISOString() },
  }
}
