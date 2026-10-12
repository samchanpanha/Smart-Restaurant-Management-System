import AppShell from './components/AppShell'
import { RestoraProvider, useRestora } from './lib/store'
import ComingSoon from './screens/ComingSoon'
import FloorScreen from './screens/FloorScreen'
import KitchenScreen from './screens/KitchenScreen'
import SystemScreen from './screens/SystemScreen'
import TicketsScreen from './screens/TicketsScreen'

function Router() {
  const { screen } = useRestora()
  if (screen === 'system') return <SystemScreen />
  if (screen === 'floor') return <FloorScreen />
  if (screen === 'tickets') return <TicketsScreen />
  if (screen === 'kitchen') return <KitchenScreen />
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
