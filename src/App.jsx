import AppShell from './components/AppShell'
import { RestoraProvider, useRestora } from './lib/store'
import ComingSoon from './screens/ComingSoon'
import CostingScreen from './screens/CostingScreen'
import DashboardScreen from './screens/DashboardScreen'
import FloorScreen from './screens/FloorScreen'
import InventoryScreen from './screens/InventoryScreen'
import KitchenScreen from './screens/KitchenScreen'
import MenuScreen from './screens/MenuScreen'
import SystemScreen from './screens/SystemScreen'
import TicketsScreen from './screens/TicketsScreen'

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
  return <ComingSoon screen={screen} />
}

export default function App() {
  return (
    <RestoraProvider>
      <AppShell>
        <Router />
      </AppShell>
    </RestoraProvider>
  )
}
