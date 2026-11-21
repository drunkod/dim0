/** Temporary private Jazz sign-in entry for opt-in Dim0 canvas boards.
 * Better Auth remains the authority; the server verifies each subsequent
 * canvas read/write independently and never trusts the browser's role.
 */
export function JazzSignInPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Sign in to the private Jazz board</h1>
      <p>
        The experimental Jazz-backed canvas uses Patchboard passkey sessions.
        Sign in first, then open your Dim0 board URL again. Your existing Dim0
        account is not used to authorize Jazz content.
      </p>
      <a
        href="/patchboard-private/"
        className="rounded-md border px-4 py-2 font-medium hover:bg-muted"
      >
        Open private passkey sign-in
      </a>
      <p className="text-sm text-muted-foreground">
        The Jazz adapter is opt-in and not yet a production migration.
      </p>
    </main>
  )
}
