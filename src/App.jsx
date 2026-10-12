import AppShell from './components/AppShell'
import { RestoraProvider, useRestora } from './lib/store'
import ComingSoon from './screens/ComingSoon'
import SystemScreen from './screens/SystemScreen'

function Router() {
  const { screen } = useRestora()
  if (screen === 'system') return <SystemScreen />
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
