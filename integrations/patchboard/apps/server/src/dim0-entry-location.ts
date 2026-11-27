/** Translate the old private app entry point into the existing Dim0 routes.
 * This is navigation only: Jazz validates expiry, role and single-use redemption.
 */
export function dim0EntryLocation(rawUrl: string): string | null {
  const url = new URL(rawUrl, "http://localhost");
  const query = url.searchParams;
  if (!query.has("board") && !query.has("invite")) {
    // Preserve existing OAuth state/query parameters in the normal sign-in path.
    return "/signin" + url.search;
  }

  const board = query.get("board") ?? "";
  const invite = query.get("invite") ?? "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const code = /^[\w-]{43}$/;
  if (query.getAll("board").length !== 1 || query.getAll("invite").length !== 1 ||
      !uuid.test(board) || !code.test(invite)) {
    return null;
  }

  // The code must not be carried as a query through authentication.
  // A URL fragment is not sent to the HTTP server on the next request.
  return "/share/join/" + board + "#invite=" + invite;
}
