import { schema as s } from "jazz-tools";
import { schema } from "./schema.ts";

/**
 * Private-room security boundary, separate from the disposable no-auth guest demo.
 * Browser clients are read-only: all identity, invitations, mutations and author
 * attribution go through authenticated, authorization-checked server commands.
 *
 * Never serve this schema through acceptDeviceAccounts. An unsigned Jazz identity
 * must not be able to read even the existence of a private board.
 */
const { definePermissions, exists, anyOf, session } = schema;
const mayRead = (boardId: s.Uuid) =>
  anyOf(
    exists.boards({ id: boardId, ownerId: session.user }),
    exists.boardMembers({ boardId, userId: session.user }),
  );

export const privatePermissions = definePermissions({
  boards: {
    read: (board) => mayRead(board.id),
    insert: false,
    update: false,
    delete: false,
  },
  boardMembers: {
    read: (member) => mayRead(member.boardId),
    insert: false,
    update: false,
    delete: false,
  },
  boardInvites: { read: false, insert: false, update: false, delete: false },
  shapes: {
    read: (shape) => mayRead(shape.boardId),
    insert: false,
    update: false,
    delete: false,
  },
  canvasEntities: {
    read: (entity) => mayRead(entity.boardId),
    insert: false,
    update: false,
    delete: false,
  },
  appletStates: {
    read: (row) => mayRead(row.boardId),
    insert: false,
    update: false,
    delete: false,
  },
  mcpRequests: { read: false, insert: false, update: false, delete: false },
  tasks: { read: false, insert: false, update: false, delete: false },
  comments: { read: false, insert: false, update: false, delete: false },
  cursors: { read: false, insert: false, update: false, delete: false },
  proposals: { read: false, insert: false, update: false, delete: false },
  checkpoints: { read: false, insert: false, update: false, delete: false },
  agentRuns: { read: false, insert: false, update: false, delete: false },
});
