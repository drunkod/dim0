import { useEffect } from "react"
import { clearAccountLocale, refreshAccountLocale } from "./index"

/** Session-scoped preference, not a device override or a stored credential. */
export function JazzLocaleBootstrap({ active, pathname }: { active: boolean; pathname: string }) {
  useEffect(() => {
    if (!active) { clearAccountLocale(); return }
    const abort = new AbortController()
    void refreshAccountLocale(abort.signal)
    return () => abort.abort()
  }, [active, pathname])
  useEffect(() => () => clearAccountLocale(), [])
  return null
}
