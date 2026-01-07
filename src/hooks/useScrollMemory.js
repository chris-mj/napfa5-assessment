import { useEffect } from 'react'

// Persist and restore window scroll position per logical page key.
// Uses sessionStorage so position is per-tab and cleared on tab close.
export default function useScrollMemory(key, restoreDeps = []) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const storage = window.sessionStorage

    const restore = () => {
      try {
        const raw = storage.getItem(key)
        const y = raw != null ? Number(raw) : 0
        if (Number.isFinite(y) && y >= 0) {
          // Use instant jump to avoid jank
          window.scrollTo(0, y)
        }
      } catch {}
    }

    const save = () => {
      try {
        storage.setItem(key, String(window.scrollY || 0))
      } catch {}
    }

    // Initial restore on mount
    restore()

    // Save on lifecycle events
    const onBeforeUnload = () => save()
    const onPageHide = () => save()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
      else setTimeout(restore, 0)
    }

    // Also lightly throttle saving during scroll
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        save()
      })
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', restore)
    window.addEventListener('focus', restore)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      save()
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', restore)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('focus', restore)
    }
  }, [key])

  // Re-apply restoration after major content changes (e.g., data loaded)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.sessionStorage.getItem(key)
      const y = raw != null ? Number(raw) : 0
      if (Number.isFinite(y) && y >= 0) {
        setTimeout(() => window.scrollTo(0, y), 0)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...restoreDeps])
}
