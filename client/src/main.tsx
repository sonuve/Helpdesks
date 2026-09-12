import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

// Error tracking only, no performance tracing/session replay — same scope
// as the server's lib/sentry.ts (see its comment for why). A missing
// VITE_SENTRY_DSN makes Sentry.init() a documented no-op (SDK disabled)
// rather than something this file needs to special-case.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0,
})

const queryClient = new QueryClient()

// React 19's error hooks report uncaught/recovered render errors to
// Sentry even with no <Sentry.ErrorBoundary> anywhere in the tree (App.tsx
// has none) — onCaughtError is included too since there's no existing
// boundary that would end up double-reporting alongside it.
const root = createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
})

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
