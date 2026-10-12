import AppShell from './components/AppShell'
import { RestoraProvider, useRestora } from './lib/store'
import ComingSoon from './screens/ComingSoon'
import FloorScreen from './screens/FloorScreen'
import SystemScreen from './screens/SystemScreen'

function Router() {
  const { screen } = useRestora()
  if (screen === 'system') return <SystemScreen />
  if (screen === 'floor') return <FloorScreen />
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
