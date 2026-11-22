import type { DatabaseSync } from "node:sqlite";

/**
 * Better Auth owns names; Jazz owns grants. This cross-reference stores ONLY
 * the server-confirmed identity mapping, not a second membership directory.
 */
export function installJazzMemberDirectory(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS patchboard_jazz_identity (
    jazz_account_id TEXT PRIMARY KEY,
    auth_user_id TEXT NOT NULL UNIQUE
  )`);
}

export function rememberJazzMemberIdentity(db: DatabaseSync, jazzAccountId: string, authUserId: string): void {
  db.prepare(`INSERT INTO patchboard_jazz_identity (jazz_account_id, auth_user_id)
    VALUES (?, ?)
    ON CONFLICT (auth_user_id) DO UPDATE SET jazz_account_id=excluded.jazz_account_id`).run(
    jazzAccountId, authUserId,
  );
}

/**
 * Recording an optional display label must never break a verified session or
 * an authorized Jazz board grant. Retain strict uniqueness in the writer so a
 * conflict cannot change or impersonate anyone else's existing mapping.
 * Resolve the database lazily to also contain database-open failures.
 */
export function tryRememberJazzMemberIdentity(
  getDatabase: () => DatabaseSync,
  jazzAccountId: string,
  authUserId: string,
): void {
  try {
    rememberJazzMemberIdentity(getDatabase(), jazzAccountId, authUserId);
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String(error.code) : "unknown";
    console.warn("Jazz member display-name mapping was skipped", { code });
  }
}

/**
 * Call only after the requester has passed the Jazz board owner check.
 * Never accept board-member IDs from the URL as a user-directory lookup.
 */
export function memberDisplayNames(db: DatabaseSync, jazzAccountIds: string[]): Map<string, string> {
  const ids = [...new Set(jazzAccountIds)];
  if (ids.length === 0) return new Map();
  if (ids.length > 201) throw new Error("Too many board members");
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT link.jazz_account_id AS id, person.name AS name
    FROM patchboard_jazz_identity AS link
    JOIN user AS person ON person.id=link.auth_user_id
    WHERE link.jazz_account_id IN (${placeholders})`).all(...ids) as
    Array<{ id: string; name: string | null }>;
  return new Map(rows.flatMap((row) => {
    const name = row.name?.trim();
    return name ? [[row.id, name.slice(0, 80)]] : [];
  }));
}
