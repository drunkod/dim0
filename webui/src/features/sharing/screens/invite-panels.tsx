import { Button } from "@/components/ui/button"
import type { ShareRole } from "../api"


export function Status({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}


export function SignInPanel({ onGoSignIn, role }: { onGoSignIn: () => void; role?: ShareRole }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">You've been invited to a board</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to your Dim0 account to accept this invitation.
      </p>
      {role && <p className="text-sm text-muted-foreground">
        {role === "member" ? "This link grants permission to view and edit the board." :
          "This link grants view-only access to the board."}
      </p>}
      <Button onClick={onGoSignIn} className="mt-2">
        Sign in
      </Button>
    </div>
  )
}


export function ReadyPanel({ role, onOpen }: { role?: ShareRole; onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">You've been invited</h1>
      <p className="text-sm text-muted-foreground">
        {role === undefined ? "Review this invitation before joining." : role === "member"
          ? "You'll be able to view and edit this board."
          : "You'll have view-only access to this board."}
      </p>
      <p className="text-xs text-muted-foreground">By accepting, you join as your current signed-in Dim0 account. A forwarded link is not proof of your identity to the inviter.</p>
      <Button onClick={onOpen} className="mt-2">
        Accept invitation
      </Button>
    </div>
  )
}


export function ErrorPanel({ message, onGoHome }: { message: string; onGoHome: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-lg font-semibold">This invitation isn't usable</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" onClick={onGoHome} className="mt-2">
        Back home
      </Button>
    </div>
  )
}
