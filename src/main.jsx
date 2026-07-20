import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { LanguageProvider } from './app/i18n-provider.jsx'
import { legacyHashPath } from './app/routes.js'

const legacyPath = legacyHashPath(window.location.hash)
if (legacyPath) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${legacyPath}`)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </LanguageProvider>
  </StrictMode>,
)
