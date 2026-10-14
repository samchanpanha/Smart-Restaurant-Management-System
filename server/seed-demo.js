// ─── Restora demo seed ───────────────────────────────────────────
// Populate one complete, believable restaurant so a client walkthrough
// has data in every module: floor, tickets, kitchen, menu, catalog,
// inventory, movements, purchases, suppliers, reports, costing, settings,
// documents, plus a sign-in account for each staff role.
//
//   npm run seed:demo
//
// Honors the same RESTORA_DATA env as the server, so it writes the demo
// into whatever database the server will boot from. Idempotent: re-running
// refreshes the same owner, accounts, and snapshot.

import { buildEmpire } from '../src/lib/reducer.js'
import { closeDatabase, loadSnapshot, saveSnapshot } from './db.js'
import { DEMO_PASSWORD, seedDemoTenant } from './auth.js'

const ownerName = process.env.DEMO_OWNER_NAME || 'Restora Demo'
const slug = process.env.DEMO_SLUG || 'restora-demo'
const password = process.env.DEMO_PASSWORD || DEMO_PASSWORD
const baseUrl = String(process.env.RESTORA_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '')

function main() {
  const { owner, accounts } = seedDemoTenant({ ownerName, slug, password })

  const state = buildEmpire()
  const seq = loadSnapshot(owner.id)?.seq || 0
  saveSnapshot(owner.id, state, seq)

  const shops = Object.values(state.locations || {})
  const line = (label, value) => console.log(`  ${label.padEnd(14)} ${value}`)

  console.log('\n✓ Demo restaurant ready\n')
  line('Owner', owner.name)
  line('Slug', owner.slug)
  line('Locations', shops.map((s) => s.settings?.restaurantName || 'shop').join(', '))
  line('Tables', shops.reduce((n, s) => n + (s.tables?.length || 0), 0))
  line('Menu items', shops.reduce((n, s) => n + (s.menu?.length || 0), 0))
  line('Documents', shops.reduce((n, s) => n + (s.documents?.length || 0), 0))

  console.log('\n  Sign in at   ' + baseUrl + '/login')
  console.log('  Guest menu   ' + baseUrl + '/?owner=' + owner.slug)
  console.log('\n  Accounts')
  for (const account of accounts) {
    line(account.label, `${account.email}  /  ${account.password}`)
  }
  console.log('\n  Start the server:  npm run server\n')
}

try {
  main()
} catch (error) {
  console.error('\n✗ Demo seed failed:', error?.message || error)
  process.exitCode = 1
} finally {
  closeDatabase()
}
