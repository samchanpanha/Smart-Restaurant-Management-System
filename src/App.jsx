import AppShell from './components/AppShell'
import { Icon } from './components/Icon'
import { NAV_SECTIONS, ROLE_NAV } from './lib/constants'
import { translateScreenLabel, useI18n } from './lib/i18n'
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
import UsersScreen from './screens/UsersScreen'
import RolesScreen from './screens/RolesScreen'
import OwnersScreen from './screens/OwnersScreen'
import AuthScreen from './screens/AuthScreen'
import { AuthProvider, useAuth } from './lib/auth'

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

/**
 * The mini app picks its own table when the link came from the chat rather
 * than a table QR: MiniAppScreen prefers a table already in service.
 */
function MiniAppFrame({ tableId }) {
  return <MiniAppScreen tableId={tableId || ''} />
}

/**
 * A tab keeps the screen it was opened with, but a role that cannot open
 * that screen must not see it. The tab stays on the strip — closed by the
 * operator or unlocked by switching role — and the panel says why.
 */
function RestrictedScreen({ screen, role }) {
  const { setRole } = useRestora()
  const { lang, dict } = useI18n()
  const rs = dict.restrictedScreen || {}
  const screenName = translateScreenLabel(screen, SCREEN_LABELS[screen] || screen, lang)
  const roleName = dict.roles?.[role] || role
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50/70 p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
        <Icon name="lock" size={22} />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-tight text-zinc-900">
        {rs.title || `${screenName} is not part of the ${roleName} workspace`}
        {lang !== 'en' && (
          <span className="sr-only"> {SCREEN_LABELS[screen] || screen} is not part of the {role} workspace</span>
        )}
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        {rs.desc ? rs.desc(screenName, roleName) : `${roleName} role cannot access ${screenName}.`}
      </p>
      <button
        type="button"
        onClick={() => setRole('owner')}
        className="mt-5 min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
      >
        {lang === 'km' ? 'ប្ដូរទៅម្ចាស់ហាង (Owner)' : lang === 'zh' ? '切换至店主 (Owner)' : 'Switch to owner'}
      </button>
    </div>
  )
}

// Exported so tests can mount the real router inside the real shell.
export function Router() {
  const { screen, role, activeTabId } = useRestora()
  const { screens } = useAuth()
  const allowed = screens?.length ? screens : ROLE_NAV[role] || ROLE_NAV.owner
  const key = activeTabId || 'none'
  // A tab that has not picked a screen yet shows the picker.
  if (!screen) return <NewTabPicker key={key} />
  if (!allowed.includes(screen)) return <RestrictedScreen key={key} screen={screen} role={role} />
  if (screen === 'system') return <SystemScreen key={key} />
  if (screen === 'dashboard') return <DashboardScreen key={key} />
  if (screen === 'floor') return <FloorScreen key={key} />
  if (screen === 'tickets') return <TicketsScreen key={key} />
  if (screen === 'kitchen') return <KitchenScreen key={key} />
  if (screen === 'inventory') return <InventoryScreen key={key} />
  if (screen === 'menu') return <MenuScreen key={key} />
  if (screen === 'catalog') return <CatalogScreen key={key} />
  if (screen === 'suppliers') return <SuppliersScreen key={key} />
  if (screen === 'purchases') return <PurchasesScreen key={key} />
  if (screen === 'movements') return <MovementsScreen key={key} />
  if (screen === 'settings') return <SettingsScreen key={key} />
  if (screen === 'costing') return <CostingScreen key={key} />
  if (screen === 'reports') return <ReportsScreen key={key} />
  if (screen === 'telegram') return <TelegramScreen key={key} />
  if (screen === 'users') return <UsersScreen key={key} />
  if (screen === 'roles') return <RolesScreen key={key} />
  if (screen === 'owners') return <OwnersScreen key={key} />
  return <ComingSoon key={key} screen={screen} />
}

/** A quiet hold while the session cookie is being checked. */
function AuthSplash() {
  return (
    <div className="restora-theme flex min-h-screen items-center justify-center bg-[var(--color-ink-950)] text-zinc-400">
      <span className="text-sm">Opening your workspace…</span>
    </div>
  )
}

/** The terminal workspace is behind a session; guests and the mini app are not. */
function AuthGate({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <AuthScreen />
  return children
}

export default function App() {
  const guest = guestTableId()
  const miniApp = telegramMiniApp()
  // The Telegram mini app is the guest menu with the platform chrome on top.
  if (miniApp) {
    return (
      <RestoraProvider waitForServer={false}>
        <MiniAppFrame tableId={guest} />
      </RestoraProvider>
    )
  }
  // Guests get their own light app — same provider, same live ticket.
  if (guest) {
    return (
      <RestoraProvider waitForServer={false}>
        <GuestScreen tableId={guest} />
      </RestoraProvider>
    )
  }
  return (
    <AuthProvider>
      <AuthGate>
        <RestoraProvider>
          <AppShell>
            <Router />
          </AppShell>
        </RestoraProvider>
      </AuthGate>
    </AuthProvider>
  )
}