import { useCopy } from "@/i18n"
import { resetSignedOutState } from "../reset-signed-out-state"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LogoutIcon } from "@/components/icons"
import { signOutOfJazz } from "@/features/board/jazz/jazz-auth-client"


/** End the board session before discarding private state and returning to sign-in. */
export function JazzLogoutButton() {
  const { t } = useCopy()
  const [busy, setBusy] = useState(false)
  const cache = useQueryClient()
  async function logout() {
    setBusy(true)
    try {
      await signOutOfJazz()
      resetSignedOutState(cache)
      location.replace("/signin")
    } catch {
      toast.error(t("Could not sign out. Try again."))
      setBusy(false)
    }
  }
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void logout()}><LogoutIcon />{t("Sign out")}</Button>
}
