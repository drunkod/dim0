import type { QueryClient } from "@tanstack/react-query"
import { useAppStore } from "@/store"


/** Restore Dim0's signed-out defaults after the active identity provider signs out. */
export function resetSignedOutState(cache: QueryClient) {
  cache.clear()
  const state = useAppStore.getState()
  state.setUserId("root")
  state.setUserEmail("root@localhost")
  state.setUserPlan("free")
  state.setEmailVerificationEnabled(false)
  state.setEmailVerified(true)
}
