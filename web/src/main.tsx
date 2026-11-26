import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyScheme, applyTheme, loadScheme, loadTheme } from './theme/theme'

applyTheme(loadTheme())
applyScheme(loadScheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
