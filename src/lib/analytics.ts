// ---------------------------------------------------------------------------
// Analytics — Google Analytics 4 (gtag) + a small, Router-aware page-view hook.
//
// We deliberately keep this self-contained: no React deps in the loader, no
// network call at all when `VITE_GA_ID` is unset. That way an open-source fork
// runs with zero tracking out of the box; deployers opt in by setting the env
// var on their host (Vercel: Project → Settings → Environment Variables →
// VITE_GA_ID = G-XXXXXXXXXX).
//
// To enable: set the env var in your host (Vercel) and redeploy. Locally you
// can put it in `.env.local`:
//
//     VITE_GA_ID=G-XXXXXXXXXX
//
// Standard GA4 collection runs on every page view emitted by `usePageviews`.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GA_ID = (import.meta.env.VITE_GA_ID as string | undefined)?.trim()

/** Inject the gtag snippet once. Safe to call multiple times. */
export function installGoogleAnalytics(): void {
  if (typeof window === 'undefined') return
  if (!GA_ID) return
  if (window.gtag) return // already installed

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  function gtag(...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  window.gtag = gtag

  gtag('js', new Date())
  // We push manual page_view events from the Router hook, so disable the
  // default one to avoid double-counting.
  gtag('config', GA_ID, { send_page_view: false })
}

/** Fire a single page_view event. No-op when GA isn't installed. */
export function trackPageview(path: string, title?: string): void {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title ?? document.title,
    page_location: window.location.href,
  })
}

/** Fire a custom event. No-op when GA isn't installed. */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', name, params)
}

export const isAnalyticsEnabled = Boolean(GA_ID)
