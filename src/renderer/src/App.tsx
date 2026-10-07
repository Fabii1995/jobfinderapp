import { AppShell } from '@renderer/components/layout/AppShell'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useTheme } from '@renderer/hooks/useTheme'

function App(): React.JSX.Element {
  useTheme()
  return (
    <TooltipProvider delayDuration={300}>
      <AppShell />
      <Toaster richColors closeButton />
    </TooltipProvider>
  )
}

export default App
