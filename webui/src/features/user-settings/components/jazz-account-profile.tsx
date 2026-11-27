import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Profile = {
  display_name: string
  locale: string
  version: number
  email_required: false
  backup_passkey_enrollment_available: false
}
type ConnectedGrant = {
  id: string; clientId: string; boardId: string; grantVersion: number
  createdAtMs: number; revokedAtMs: number | null
}
type GrantList = { grants: ConnectedGrant[]; hasMore: boolean }
type GrantRevocation = { grant_id: string; version: number; revoked_at_ms: number }
type AccountEvent = { type: string; at: number; detail: unknown }
const path = "/patchboard-private/api/account/"
async function accountFetch<T>(resource: string, body?: object, method: "PATCH" | "POST" = "PATCH"): Promise<T> {
  const response = await fetch(path + resource, {
    credentials: "same-origin",
    cache: "no-store",
    ...(body ? {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? "Account settings unavailable")
  return payload
}
/**
 * A real session-scoped self-profile editor only in private Jazz canvas mode.
 * Not an email/password settings page. Additional passkey and recovery methods
 * stay visibly disabled until Better Auth 1.7.1 enrollment is tested.
 */
export function JazzAccountProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState("")
  const [locale, setLocale] = useState("")
  const [events, setEvents] = useState<AccountEvent[]>([])
  const [connected, setConnected] = useState<GrantList | null>(null)
  const [connectedState, setConnectedState] = useState<"loading" | "ready" | "unavailable">("loading")
  const [status, setStatus] = useState("Loading your passkey account…")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let mounted = true
    void Promise.all([
      accountFetch<Profile>("profile"),
      accountFetch<{ events: AccountEvent[] }>("activity"),
    ]).then(([p, activity]) => {
      if (!mounted) return
      setProfile(p)
      setName(p.display_name)
      setLocale(p.locale)
      setEvents(activity.events)
      setStatus("")
    }).catch(error => {
      if (mounted) setStatus(error instanceof Error ? error.message : "Profile unavailable")
    })
    void accountFetch<GrantList>("connected-apps").then(grants => {
      if (!mounted) return
      setConnected(grants)
      setConnectedState("ready")
    }).catch(() => {
      if (mounted) setConnectedState("unavailable")
    })
    return () => { mounted = false }
  }, [])
  async function saveName() {
    if (!profile || busy) return
    setBusy(true)
    setStatus("")
    try {
      const updated = await accountFetch<{ display_name: string }>("profile", { display_name: name })
      setProfile({ ...profile, display_name: updated.display_name })
      setName(updated.display_name)
      setStatus("Display name saved.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Name could not be saved")
    } finally { setBusy(false) }
  }
  async function saveLocale() {
    if (!profile || busy) return
    setBusy(true)
    setStatus("")
    try {
      const updated = await accountFetch<{ locale: string; version: number }>("preferences", {
        locale, expected_version: profile.version, request_id: crypto.randomUUID(),
      })
      setProfile({ ...profile, locale: updated.locale, version: updated.version })
      setLocale(updated.locale)
      const activity = await accountFetch<{ events: AccountEvent[] }>("activity")
      setEvents(activity.events)
      setStatus("Locale preference saved.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preference could not be saved; reload to see current version")
    } finally { setBusy(false) }
  }
  /** Refresh optional grant metadata without changing the confirmed mutation status. */
  async function refreshConnectedApps() {
    if (busy) return
    setBusy(true)
    try {
      setConnected(await accountFetch<GrantList>("connected-apps"))
      setConnectedState("ready")
    } catch {
      setConnectedState("unavailable")
    } finally { setBusy(false) }
  }

  /** Revoke exactly one grant, and distinguish confirmation from a list refresh. */
  async function disconnectGrant(grant: ConnectedGrant) {
    if (busy || connectedState !== "ready" || grant.revokedAtMs !== null) return
    if (!window.confirm("Disconnect this client's board access? MCP callbacks entering after revocation will be denied. Operations already started may finish.")) return
    setBusy(true)
    setStatus("")
    try {
      const receipt = await accountFetch<GrantRevocation>("connected-apps/revoke", {
        grant_id: grant.id, client_id: grant.clientId,
        expected_version: grant.grantVersion, request_id: crypto.randomUUID(),
      }, "POST")
      if (receipt.grant_id !== grant.id || !Number.isSafeInteger(receipt.version) ||
          receipt.version < grant.grantVersion || !Number.isFinite(receipt.revoked_at_ms)) {
        throw new Error("Revocation could not be confirmed; refresh before retrying.")
      }
      setConnected(current => current && ({
        ...current,
        grants: current.grants.map(item => item.id === grant.id ? {
          ...item, grantVersion: receipt.version, revokedAtMs: receipt.revoked_at_ms,
        } : item),
      }))
      try {
        setConnected(await accountFetch<GrantList>("connected-apps"))
        setConnectedState("ready")
        setStatus("Connected app grant revoked. Browser sessions and other clients are unaffected.")
      } catch {
        setConnectedState("unavailable")
        setStatus("Connected app grant revoked. Grant list temporarily unavailable; refresh to verify current state.")
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Revocation could not be confirmed; refresh before retrying.")
    } finally { setBusy(false) }
  }

  if (!profile) return <p role="status" className="text-sm text-muted-foreground">{status}</p>
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Your account signs in with a passkey. An email address is not required.</p>
        <label htmlFor="jazz-profile-name" className="text-sm font-medium">Display name</label>
        <Input id="jazz-profile-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
        <Button type="button" disabled={busy || name.trim() === profile.display_name} onClick={() => void saveName()}>
          Save display name
        </Button>
      </div>
      <div className="space-y-2">
        <label htmlFor="jazz-profile-locale" className="text-sm font-medium">Preferred locale (BCP 47)</label>
        <Input id="jazz-profile-locale" value={locale} maxLength={35} onChange={event => setLocale(event.target.value)} />
        <p className="text-xs text-muted-foreground">Saved privately for your account. This does not change the app language yet.</p>
        <Button type="button" disabled={busy || locale === profile.locale} onClick={() => void saveLocale()}>
          Save locale preference
        </Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Passkey recovery readiness</h3>
        <p className="text-sm text-muted-foreground">
          Enrolling another passkey is recommended, but this account-management feature is not available yet.
          If every previously trusted passkey is lost, recovery is unavailable. No email reset is provided.
        </p>
        <Button type="button" variant="secondary" disabled aria-disabled="true">Add backup passkey — unavailable</Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Connected OAuth / MCP apps</h3>
        <p className="text-xs text-muted-foreground">
          These are individual board grants for your account. Disconnecting one client does not sign you out or revoke other clients.
          Client IDs are shown because an app display name has not been verified.
        </p>
        {connectedState === "loading" ? <p className="text-sm text-muted-foreground">Loading connected apps…</p> :
          connectedState === "unavailable" ? <p className="text-sm text-muted-foreground">Connected apps unavailable; refresh to retry.</p> :
          !connected?.grants.length ? <p className="text-sm text-muted-foreground">No recorded board grants.</p> : (
            <ul className="space-y-2">
              {connected.grants.map(grant => (
                <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs">
                  <div className="min-w-0">
                    <p className="break-all font-medium">Client {grant.clientId}</p>
                    <p className="text-muted-foreground">Board {grant.boardId.slice(0, 12)} · {grant.revokedAtMs === null ? "Active" : "Revoked"}</p>
                  </div>
                  <Button size="sm" variant="outline" type="button"
                    disabled={busy || grant.revokedAtMs !== null}
                    onClick={() => void disconnectGrant(grant)}>
                    {grant.revokedAtMs !== null ? "Disconnected" : "Disconnect"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        {connectedState === "ready" && connected?.hasMore && <p className="text-xs text-muted-foreground">Only the newest 100 grant records are shown.</p>}
        <Button type="button" variant="outline" size="sm" disabled={busy || connectedState === "loading"}
          onClick={() => void refreshConnectedApps()}>Refresh connected apps</Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Account activity</h3>
        {events.length === 0 ? <p className="text-sm text-muted-foreground">No recorded account-preference changes yet.</p> :
          <ul className="space-y-1 text-sm text-muted-foreground">
            {events.map(event =>
              <li key={event.type + ":" + event.at}>
                {event.type === "account.locale.changed" ? "Locale preference changed" : "Account preference changed"}
                {" · "}{new Date(event.at).toLocaleString()}
              </li>)}
          </ul>}
        <p className="text-xs text-muted-foreground">These are saved in-app records, not email or external security notifications.</p>
      </div>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  )
}
