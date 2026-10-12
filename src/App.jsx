import AppShell from './components/AppShell'
import { RestoraProvider, useRestora } from './lib/store'
import ComingSoon from './screens/ComingSoon'
import CostingScreen from './screens/CostingScreen'
import DashboardScreen from './screens/DashboardScreen'
import FloorScreen from './screens/FloorScreen'
import GuestScreen from './screens/GuestScreen'
import InventoryScreen from './screens/InventoryScreen'
import KitchenScreen from './screens/KitchenScreen'
import MenuScreen from './screens/MenuScreen'
import ReportsScreen from './screens/ReportsScreen'
import SystemScreen from './screens/SystemScreen'
import TicketsScreen from './screens/TicketsScreen'

function guestTableId() {
  try {
    return new URLSearchParams(window.location.search).get('guest')
  } catch {
    return null
  }
}

function Router() {
  const { screen } = useRestora()
  if (screen === 'system') return <SystemScreen />
  if (screen === 'dashboard') return <DashboardScreen />
  if (screen === 'floor') return <FloorScreen />
  if (screen === 'tickets') return <TicketsScreen />
  if (screen === 'kitchen') return <KitchenScreen />
  if (screen === 'inventory') return <InventoryScreen />
  if (screen === 'menu') return <MenuScreen />
  if (screen === 'costing') return <CostingScreen />
  if (screen === 'reports') return <ReportsScreen />
  return <ComingSoon screen={screen} />
}

export default function App() {
  const guest = guestTableId()
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
