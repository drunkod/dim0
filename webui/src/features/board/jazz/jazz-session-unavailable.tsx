import { useRouter, type ErrorComponentProps } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

export class JazzSessionCheckError extends Error {
  constructor() {
    super("Could not verify the Jazz session")
    this.name = "JazzSessionCheckError"
  }
}

/** A temporary failure is not evidence that the member is signed out.
 * Keep the original URL and retry the protected loader without exposing
 * stale board content or redirecting to a different identity.
 */
export function JazzSessionUnavailable({ error }: ErrorComponentProps) {
  const router = useRouter()
  const sessionFailure = error instanceof JazzSessionCheckError
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">
        {sessionFailure ? "Couldn’t check your Jazz account" : "This board is temporarily unavailable"}
      </h1>
      <p role="alert" className="text-sm text-muted-foreground">
        {sessionFailure ? "Your board destination is preserved. Retry when the connection returns." :
          "We couldn’t open this board. Retry, or return to your local boards."}
      </p>
      <div className="flex gap-3">
        <Button onClick={() => void router.invalidate()}>Retry connection</Button>
        <Button variant="outline" asChild><a href="/local">Local boards</a></Button>
      </div>
    </main>
  )
}
