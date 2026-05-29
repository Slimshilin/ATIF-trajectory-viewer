import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import { DatasetProvider } from './lib/dataset'
import { AuthProvider } from './lib/auth'
import { installGoogleAnalytics } from './lib/analytics'
import './index.css'

// Google Analytics 4 — only active when VITE_GA_ID is set at build time
// (e.g. via a Vercel project env var). No-ops on local dev or for forks.
installGoogleAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DatasetProvider>
          <App />
          {/* Vercel Web Analytics — active on the Vercel deploy only; no-ops elsewhere. */}
          <Analytics />
        </DatasetProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
