/**
 * Real private per-subject SQLite preference ledger. Never copies Better Auth
 * secrets, normalizes recipient email, or writes settings into Jazz.
 * Pinned upstream: UserController.updateLang (ACC-039), UserController.updateName
 * (ACC-037). No claim of full source profile parity.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizedAccountLocale } from "@patchboard/account-domain/profile";

export class ProfileConflict extends Error {
  constructor(readonly code: "STALE_STATE" | "REQUEST_ID_CONFLICT" | "RECEIPT_STALE") {
    super(code);
  }
}
export type AccountPreferences = Readonly<{
  locale: string;
  version: number;
}>;
export type UpdatePreferences = Readonly<{
  locale: string;
  expectedVersion: number;
  requestId: string;
}>;
export type UpdatedPreferences = Readonly<AccountPreferences & { changed: boolean }>;

type PreferencesRow = { locale: string; version: number };
type ReceiptRow = { fingerprint: string; version: number; locale: string; changed: number };

export function installAccountPreferenceTables(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS patchboard_account_preferences (
    subject_id TEXT PRIMARY KEY,
    locale TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version >= 1),
    updated_at_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS patchboard_account_preferences_receipt (
    subject_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    version INTEGER NOT NULL,
    locale TEXT NOT NULL,
    changed INTEGER NOT NULL,
    PRIMARY KEY(subject_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS patchboard_account_activity (
    subject_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL,
    safe_metadata TEXT NOT NULL,
    PRIMARY KEY(subject_id,request_id)
  );`);
}
function current(db: DatabaseSync, subject: string): PreferencesRow {
  const row = db.prepare(`SELECT locale,version FROM patchboard_account_preferences
    WHERE subject_id=?`).get(subject) as PreferencesRow | undefined;
  return row ?? { locale:"en", version:0 };
}
export function readAccountPreferences(db: DatabaseSync, subject: string): AccountPreferences {
  if (!subject) throw new Error("UNVERIFIED_SUBJECT");
  return current(db, subject);
}
export function updateAccountPreferences(
  db: DatabaseSync, subject: string, input: UpdatePreferences, nowEpochMs = Date.now()
): UpdatedPreferences {
  if (!subject) throw new Error("UNVERIFIED_SUBJECT");
  const locale = normalizedAccountLocale(input.locale);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw new Error("INVALID_PREFERENCE_REQUEST");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({locale,expectedVersion:input.expectedVersion}))
    .digest("hex");
  // Same SQLite file/transaction serializes all app instances sharing this
  // private authority. No cross-store atomicity with Jazz is claimed.
  db.exec("BEGIN IMMEDIATE");
  try {
    const before = current(db, subject);
    const prior = db.prepare(`SELECT fingerprint,version,locale,changed
      FROM patchboard_account_preferences_receipt WHERE subject_id=? AND request_id=?`)
      .get(subject,input.requestId) as ReceiptRow | undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ProfileConflict("REQUEST_ID_CONFLICT");
      // Stale receipt cannot mislead UI after a later, separately committed update.
      if (prior.version !== before.version) throw new ProfileConflict("RECEIPT_STALE");
      db.exec("COMMIT");
      return {locale:before.locale,version:before.version,changed:Boolean(prior.changed)};
    }
    if (before.version !== input.expectedVersion) throw new ProfileConflict("STALE_STATE");
    const changed = before.locale !== locale;
    const nextVersion = changed ? before.version + 1 : before.version;
    if (changed) {
      db.prepare(`INSERT INTO patchboard_account_preferences
        (subject_id,locale,version,updated_at_ms) VALUES(?,?,?,?)
        ON CONFLICT(subject_id) DO UPDATE SET
          locale=excluded.locale, version=excluded.version, updated_at_ms=excluded.updated_at_ms`)
        .run(subject,locale,nextVersion,nowEpochMs);
      db.prepare(`INSERT INTO patchboard_account_activity
        (subject_id,request_id,event_type,occurred_at_ms,safe_metadata)
        VALUES (?,?,?,?,?)`).run(
        subject,input.requestId,"account.locale.changed",nowEpochMs,
        JSON.stringify({from:before.locale,to:locale,version:nextVersion}),
      );
    }
    db.prepare(`INSERT INTO patchboard_account_preferences_receipt
      (subject_id,request_id,fingerprint,version,locale,changed)
      VALUES(?,?,?,?,?,?)`).run(subject,input.requestId,fingerprint,nextVersion,locale,Number(changed));
    db.exec("COMMIT");
    return {locale,version:nextVersion,changed};
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
