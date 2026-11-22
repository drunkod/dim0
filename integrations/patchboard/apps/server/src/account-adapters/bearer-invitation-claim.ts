/**
 * Existing Dim0 bearer-link redemption, shared by the authenticated HTTP route
 * and the Jazz serializable regression tests. Never call with a browser-chosen
 * actor: the route passes the trusted Better Auth -> Jazz account binding.
 * Legacy reusable/single-use link semantics remain unchanged.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";

/** Claim a previously validated secret digest as a trusted existing Jazz actor. */
export async function claimBearerInvitation(
  db: Db, boardId: string, digest: string, accountId: string,
): Promise<{ role: "editor" | "viewer" }> {
  const write = await db.serializableTransaction(async (tx) => {
    const invite = await tx.one(app.boardInvites.where({ boardId, token: digest }));
    if (!invite || (invite.expiresAtEpochMs !== null &&
        invite.expiresAtEpochMs < Date.now()) ||
        (invite.intendedUserId && invite.intendedUserId !== accountId)) {
      throw new Error("INVITE_INVALID");
    }
    const existing = await tx.one(app.boardMembers.where({ boardId, userId: accountId }));
    if (existing && invite.singleUse) throw new Error("INVITE_INVALID");
    const board = await tx.one(app.boards.where({ id: boardId }));
    if (!board) throw new Error("INVITE_INVALID");
    if (existing) {
      // Existing link contract: upgrade Viewer to Editor; never downgrade.
      if (existing.role === "viewer" && invite.role === "editor") {
        // ALL role-changing paths share the owner's expectedVersion CAS.
        // The same serializable transaction advances role and roleVersion.
        // An already-Editor member or Viewer link is a version-neutral no-op.
        tx.update(app.boardMembers, existing.id, {
          role: "editor", roleVersion: existing.roleVersion + 1,
        });
      }
    } else if (board.ownerId !== accountId) {
      tx.insert(app.boardMembers, { boardId, userId: accountId, role: invite.role },
        { id: randomUUID() });
    }
    if (invite.singleUse) tx.delete(app.boardInvites, invite.id);
    return { role: invite.role };
  });
  await write.wait({ timeoutMs: 10000 });
  return write.value;
}
