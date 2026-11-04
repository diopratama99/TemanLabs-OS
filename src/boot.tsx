import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/glass.css'
import './styles/app.css'
import App from './App'
import { MobileApp } from './mobile/MobileApp'
import './styles/mobile.css'
import { AuthGate } from './lib/auth'
import { ContextMenuProvider } from './lib/contextMenu'
import { SettingsProvider } from './lib/settings'
import { SHELL } from './lib/shell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthGate>
        <ContextMenuProvider>
          {SHELL === 'mobile' ? <MobileApp /> : <App />}
        </ContextMenuProvider>
      </AuthGate>
    </SettingsProvider>
  </StrictMode>,
)
