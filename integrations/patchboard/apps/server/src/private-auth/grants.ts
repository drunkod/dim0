import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { requirePrivateBoardAccess } from "../board-service.ts";
import { privateAuthDatabase } from "./db.ts";

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
/** Old and unbound tokens receive no Patchboard board authority. */
export function tokenBoardGrantClaim(id: string | undefined, userId: string | undefined) {
  if (!id || !userId) return {};
  const row = rowFor(id);
  if (!row || row.revoked_at_ms !== null || row.user_id !== userId) return {};
  return { patchboard_grant_id: id };
}
export function revokeBoardGrant(id: string) {
  privateAuthDatabase().prepare(
    "UPDATE patchboard_oauth_grant SET revoked_at_ms=? WHERE id=? AND revoked_at_ms IS NULL",
  ).run(Date.now(), id);
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
