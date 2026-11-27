import { createHash, randomBytes, randomUUID } from "node:crypto";
import { privateAuthDatabase } from "./db.ts";

const EXPIRY_MS = 5 * 60_000;
const ticketHash = (ticket: string) => createHash("sha256").update(ticket).digest("hex");
const validTicket = (ticket: string | null | undefined): ticket is string =>
  typeof ticket === "string" && /^[\w-]{43}$/.test(ticket);

function cap() {
  const value = Number(process.env.PATCHBOARD_PRIVATE_REGISTRATION_CAP ?? "128");
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("Invalid PATCHBOARD_PRIVATE_REGISTRATION_CAP");
  }
  return value;
}

export class EnrollmentLimitReached extends Error {
  constructor() { super("Too many pending registrations"); this.name = "EnrollmentLimitReached"; }
}

/** A SQLite IMMEDIATE transaction serializes cleanup/count/insert even across processes. */
export async function newRegistrationIntent(now = Date.now()): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const db = privateAuthDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM patchboard_enrollment_intent WHERE expires_at_ms<=?").run(now);
    const count = db.prepare("SELECT COUNT(*) AS total FROM patchboard_enrollment_intent")
      .get() as { total: number };
    if (count.total >= cap()) throw new EnrollmentLimitReached();
    db.prepare(`INSERT INTO patchboard_enrollment_intent
      (ticket_hash,user_id,display_name,expires_at_ms) VALUES (?,?,?,?)`).run(
      ticketHash(ticket), id, "Patchboard " + id.slice(0, 8), now + EXPIRY_MS,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return ticket;
}

export async function resolveRegistrationIntent(ticket: string | null | undefined, now = Date.now()) {
  if (!validTicket(ticket)) throw new Error("Invalid registration ticket");
  const row = privateAuthDatabase().prepare(`SELECT user_id, display_name, expires_at_ms
      FROM patchboard_enrollment_intent WHERE ticket_hash=?`).get(ticketHash(ticket)) as
    | { user_id: string; display_name: string; expires_at_ms: number } | undefined;
  if (!row?.user_id || !row.display_name || row.expires_at_ms <= now) {
    throw new Error("Expired or invalid registration ticket");
  }
  return { id: row.user_id, name: row.display_name };
}

/** Single DELETE ... RETURNING: exactly one concurrent finalizer can win. */
export async function consumeRegistrationIntent(
  ticket: string | null | undefined, expectedUserId: string, now = Date.now(),
) {
  if (!validTicket(ticket)) throw new Error("Invalid registration ticket");
  const deleted = privateAuthDatabase().prepare(`DELETE FROM patchboard_enrollment_intent
    WHERE ticket_hash=? AND user_id=? AND expires_at_ms>? RETURNING user_id`).get(
    ticketHash(ticket), expectedUserId, now,
  ) as { user_id: string } | undefined;
  if (!deleted) throw new Error("Expired, used or mismatched registration ticket");
}
