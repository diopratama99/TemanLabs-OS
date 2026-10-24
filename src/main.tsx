import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/glass.css'
import './styles/app.css'
import App from './App'
import { AuthGate } from './lib/auth'
import { ContextMenuProvider } from './lib/contextMenu'
import { SettingsProvider } from './lib/settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthGate>
        <ContextMenuProvider>
          <App />
        </ContextMenuProvider>
      </AuthGate>
    </SettingsProvider>
  </StrictMode>,
)
