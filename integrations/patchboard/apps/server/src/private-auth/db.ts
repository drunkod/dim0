import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { privateAuthConfig } from "./config.ts";
import { installJazzMemberDirectory } from "./member-directory.ts";
import { installAccountPreferenceTables } from "../account-adapters/profile-preferences.ts";
import { installGrantAdmissionLedger } from "../account-adapters/grant-admission.ts";

let database: DatabaseSync | undefined;
/** Better Auth owns this dedicated SQLite store. It is not a Jazz application table. */
export function privateAuthDatabase(): DatabaseSync {
  if (database) return database;
  const db = new DatabaseSync(privateAuthConfig().databasePath);
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  // Patchboard-owned tables: separate from Better Auth's schema/migrations.
  db.exec(`CREATE TABLE IF NOT EXISTS patchboard_oauth_grant (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS patchboard_oauth_grant_user ON patchboard_oauth_grant(user_id);
  CREATE TABLE IF NOT EXISTS patchboard_enrollment_intent (
    ticket_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS patchboard_enrollment_expiry ON patchboard_enrollment_intent(expires_at_ms);`);
  installJazzMemberDirectory(db);
  installAccountPreferenceTables(db);
  installGrantAdmissionLedger(db);
  db.prepare("DELETE FROM patchboard_enrollment_intent WHERE expires_at_ms<=?").run(Date.now());
  // Preserve live five-minute registrations from the historical file store,
  // while removing abandoned/invalid file tickets on first upgraded startup.
  const legacyDir = join(dirname(privateAuthConfig().databasePath), "enrollment-intents");
  if (existsSync(legacyDir)) for (const filename of readdirSync(legacyDir)) {
    if (!/^[0-9a-f]{64}\.json$/.test(filename)) continue;
    const legacyPath = join(legacyDir, filename);
    try {
      const item = JSON.parse(readFileSync(legacyPath, "utf8")) as {
        userId?: unknown; displayName?: unknown; expiresAt?: unknown;
      };
      if (typeof item.userId === "string" && typeof item.displayName === "string" &&
          typeof item.expiresAt === "number" && item.expiresAt > Date.now()) {
        db.prepare(`INSERT OR IGNORE INTO patchboard_enrollment_intent
          (ticket_hash,user_id,display_name,expires_at_ms) VALUES(?,?,?,?)`).run(
          filename.slice(0, -5), item.userId, item.displayName, item.expiresAt,
        );
      }
      unlinkSync(legacyPath);
    } catch {
      // Do not accidentally erase a file that cannot be safely parsed or moved.
      // It is never issued by the new implementation, so it can't grow.
    }
  }
  // These files hold sign-in sessions and OAuth grants. Parent directory is 0700,
  // and files must never be world-readable even if umask is permissive.
  for (const filename of [
    privateAuthConfig().databasePath,
    privateAuthConfig().databasePath + "-wal",
    privateAuthConfig().databasePath + "-shm",
  ]) if (existsSync(filename)) chmodSync(filename, 0o600);
  database = db;
  return db;
}
export function closePrivateAuthDatabase() {
  database?.close();
  database = undefined;
}
