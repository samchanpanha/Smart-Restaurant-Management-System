import AppShell from './components/AppShell'
import { Icon } from './components/Icon'
import { NAV_SECTIONS, ROLE_NAV } from './lib/constants'
import { RestoraProvider, useRestora } from './lib/store'
import CatalogScreen from './screens/CatalogScreen'
import ComingSoon from './screens/ComingSoon'
import MiniAppScreen from './screens/MiniAppScreen'
import TelegramScreen from './screens/TelegramScreen'
import NewTabPicker from './components/NewTabPicker'
import CostingScreen from './screens/CostingScreen'
import DashboardScreen from './screens/DashboardScreen'
import FloorScreen from './screens/FloorScreen'
import GuestScreen from './screens/GuestScreen'
import InventoryScreen from './screens/InventoryScreen'
import KitchenScreen from './screens/KitchenScreen'
import MenuScreen from './screens/MenuScreen'
import MovementsScreen from './screens/MovementsScreen'
import PurchasesScreen from './screens/PurchasesScreen'
import ReportsScreen from './screens/ReportsScreen'
import SettingsScreen from './screens/SettingsScreen'
import SuppliersScreen from './screens/SuppliersScreen'
import SystemScreen from './screens/SystemScreen'
import TicketsScreen from './screens/TicketsScreen'

function guestTableId() {
  try {
    return new URLSearchParams(window.location.search).get('guest')
  } catch {
    return null
  }
}

/** ?tg=1 opens the Telegram mini app instead of the terminal workspace. */
function telegramMiniApp() {
  try {
    return new URLSearchParams(window.location.search).get('tg') !== null
  } catch {
    return false
  }
}

const SCREEN_LABELS = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item.label])),
)

/** The mini app falls back to the first table when the link has no table. */
function MiniAppFrame({ tableId }) {
  const { state } = useRestora()
  const resolved = tableId || state.tables[0]?.id || ''
  return <MiniAppScreen tableId={resolved} />
}

/**
 * A tab keeps the screen it was opened with, but a role that cannot open
 * that screen must not see it. The tab stays on the strip — closed by the
 * operator or unlocked by switching role — and the panel says why.
 */
function RestrictedScreen({ screen, role }) {
  const { setRole } = useRestora()
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50/70 p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
        <Icon name="lock" size={22} />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-tight text-zinc-900">
        {SCREEN_LABELS[screen] || screen} is not part of the {role} workspace
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        The tab is still here — this role just cannot open that screen. Close the tab, or switch
        back to a role that can.
      </p>
      <button
        type="button"
        onClick={() => setRole('owner')}
        className="mt-5 min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
      >
        Switch to owner (demo)
      </button>
    </div>
  )
}

// Exported so tests can mount the real router inside the real shell.
export function Router() {
  const { screen, role } = useRestora()
  const allowed = ROLE_NAV[role] || ROLE_NAV.owner
  // A tab that has not picked a screen yet shows the picker.
  if (!screen) return <NewTabPicker />
  if (!allowed.includes(screen)) return <RestrictedScreen screen={screen} role={role} />
  if (screen === 'system') return <SystemScreen />
  if (screen === 'dashboard') return <DashboardScreen />
  if (screen === 'floor') return <FloorScreen />
  if (screen === 'tickets') return <TicketsScreen />
  if (screen === 'kitchen') return <KitchenScreen />
  if (screen === 'inventory') return <InventoryScreen />
  if (screen === 'menu') return <MenuScreen />
  if (screen === 'catalog') return <CatalogScreen />
  if (screen === 'suppliers') return <SuppliersScreen />
  if (screen === 'purchases') return <PurchasesScreen />
  if (screen === 'movements') return <MovementsScreen />
  if (screen === 'settings') return <SettingsScreen />
  if (screen === 'costing') return <CostingScreen />
  if (screen === 'reports') return <ReportsScreen />
  if (screen === 'telegram') return <TelegramScreen />
  return <ComingSoon screen={screen} />
}

export default function App() {
  const guest = guestTableId()
  const miniApp = telegramMiniApp()
  // The Telegram mini app is the guest menu with the platform chrome on top.
  if (miniApp) {
    return (
      <RestoraProvider>
        <MiniAppFrame tableId={guest} />
      </RestoraProvider>
    )
  }
  // Guests get their own light app — same provider, same live ticket.
  if (guest) {
    return (
      <RestoraProvider>
        <GuestScreen tableId={guest} />
      </RestoraProvider>
    )
  }
  return (
    <RestoraProvider>
      <AppShell>
        <Router />
      </AppShell>
    </RestoraProvider>
  )
}
