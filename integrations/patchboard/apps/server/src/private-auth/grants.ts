import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { requirePrivateBoardAccess } from "../board-service.ts";
import { privateAuthDatabase } from "./db.ts";
import { revokeGrantWithReceipt } from "../account-adapters/grant-admission.ts";

/** One consent transaction per AsyncLocalStorage context, never per cookie, tab or client. */
const pending = new AsyncLocalStorage<{ id: string }>();
export const consentGrantReference = () => pending.getStore()?.id;
export const withConsentGrant = <T>(id: string, action: () => Promise<T>) =>
  pending.run({ id }, action);

type Grant = {
  id: string; user_id: string; client_id: string; board_id: string;
  revoked_at_ms: number | null;
};
export type VerifiedBoardGrant = Readonly<{
  id: string; userId: string; clientId: string; boardId: string;
}>;
const rowFor = (id: string) => privateAuthDatabase().prepare(
  "SELECT id,user_id,client_id,board_id,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?",
).get(id) as Grant | undefined;

/** The OAuth protocol's authorization transaction is the sole way to create a grant. */
export function createPendingGrant(userId: string, clientId: string, boardId: string) {
  const id = randomUUID();
  privateAuthDatabase().prepare(
    "INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES (?,?,?,?,?)",
  ).run(id, userId, clientId, boardId, Date.now());
  return id;
}
export function discardGrant(id: string) {
  privateAuthDatabase().prepare("DELETE FROM patchboard_oauth_grant WHERE id=?").run(id);
}
export function requireBoardGrant(id: unknown, userId: unknown, clientId: unknown): VerifiedBoardGrant | null {
  if (typeof id !== "string" || typeof userId !== "string" || typeof clientId !== "string") return null;
  const row = rowFor(id);
  if (!row || row.revoked_at_ms !== null || row.user_id !== userId || row.client_id !== clientId) return null;
  return { id: row.id, userId: row.user_id, clientId: row.client_id, boardId: row.board_id };
}
/**
 * A returning OAuth client can reuse a stored consent while Better Auth 1.7.1
 * omits its referenceId from the new JWT. Recover only already-approved scope
 * for exactly ONE board belonging to the verified subject and OAuth client.
 * An explicit but invalid grant ID never falls back to a different grant.
 */
export function requireConsentBoundBoardGrant(
  grantId: unknown, userId: unknown, clientId: unknown, tokenScope: unknown,
): VerifiedBoardGrant | null {
  const explicit = requireBoardGrant(grantId, userId, clientId);
  if (explicit) return explicit;
  if (grantId !== undefined && grantId !== null) return null;
  if (typeof userId !== "string" || typeof clientId !== "string" ||
      !userId || !clientId || typeof tokenScope !== "string") return null;
  const requested = tokenScope.split(/\s+/).filter((scope) =>
    scope === "board:read" || scope === "board:write" ||
    scope === "table:create");
  if (requested.length === 0) return null;
  const consents = privateAuthDatabase().prepare(
    "SELECT referenceId,scopes FROM oauthConsent WHERE userId=? AND clientId=? AND referenceId IS NOT NULL LIMIT 101",
  ).all(userId, clientId) as { referenceId: string; scopes: string }[];
  if (consents.length > 100) return null;
  const boards = new Map<string, VerifiedBoardGrant>();
  for (const consent of consents) {
    let savedScopes: unknown;
    try { savedScopes = JSON.parse(consent.scopes); } catch { continue; }
    if (!Array.isArray(savedScopes) || !savedScopes.every((scope) => typeof scope === "string")) continue;
    const allowed = new Set(savedScopes as string[]);
    if (requested.some((scope) => !allowed.has(scope))) continue;
    const grant = requireBoardGrant(consent.referenceId, userId, clientId);
    if (grant) boards.set(grant.boardId, grant);
  }
  return boards.size === 1 ? boards.values().next().value ?? null : null;
}

/** Exact table-create action consent, not merely a signed board:write token.
 * The provider's consent row binds scopes to subject, client AND grant ID.
 * Existing consents cannot acquire this operation through a scope upgrade. */
export function hasExplicitTableCreateConsent(grant:VerifiedBoardGrant):boolean{
  const rows=privateAuthDatabase().prepare(
    "SELECT scopes FROM oauthConsent WHERE userId=? AND clientId=? AND referenceId=? LIMIT 2"
  ).all(grant.userId,grant.clientId,grant.id) as {scopes:string}[];
  if(rows.length!==1)return false;
  try{
    const scopes=JSON.parse(rows[0]!.scopes) as unknown;
    return Array.isArray(scopes)&&scopes.every(scope=>typeof scope==="string")&&scopes.includes("table:create")&&scopes.includes("board:write");
  }catch{return false;}
}

/**
 * A known provider referenceId MUST remain explicit even after revocation.
 * Returning {} when the row is revoked would turn an explicit invalid token
 * into an absent-reference token, enabling legacy consent fallback onto an
 * unrelated board. The live grant check below always rejects that ID.
 * Issuer-supplied referenceId (not caller JSON) is opaque and non-secret.
 * Truly unbound legacy tokens retain their existing constrained fallback.
 */
export function tokenBoardGrantClaim(id: string | undefined, _userId: string | undefined) {
  if (!id) return {};
  return { patchboard_grant_id: id };
}
export function revokeBoardGrant(id: string) {
  // Same SQLite serialization point as every admitted MCP request.
  // Idempotent durable receipt and audit; no OAuth browser logout implied.
  revokeGrantWithReceipt(privateAuthDatabase(), id);
}
export async function listPrivateBoards(db: Db, actorId: string) {
  const own = await db.all(app.boards.where({ ownerId: actorId }).limit(200));
  const membership = await db.all(app.boardMembers.where({ userId: actorId }).limit(200));
  const items = new Map<string, { board_id: string; title: string; role: string }>();
  for (const board of own) items.set(board.id, { board_id: board.id, title: board.title, role: "owner" });
  for (const member of membership) {
    if (items.has(member.boardId)) continue;
    const board = await db.one(app.boards.where({ id: member.boardId }));
    if (board) items.set(board.id, { board_id: board.id, title: board.title, role: member.role });
  }
  return [...items.values()].sort((a, b) => a.title.localeCompare(b.title));
}
export async function grantBoardForConsent(db: Db, boardId: string, actorId: string) {
  await requirePrivateBoardAccess(db, boardId, actorId);
}
