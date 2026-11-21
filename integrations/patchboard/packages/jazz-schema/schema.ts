import { schema as s } from "jazz-tools";

/**
 * Patchboard is a Jazz-only data model. A board owner may bootstrap a new board,
 * but only the owner can grant another person's membership. Agents are members
 * with a distinct "agent" role: they can submit proposals, never edit live cards.
 */
export const schema = s.defineSchema({
  boards: s.table(
    { title: s.string(), ownerId: s.uuid() },
    {
      membersViaBoard: s.reverse("boardMembers", "board"),
      shapesViaBoard: s.reverse("shapes", "board"),
      tasksViaBoard: s.reverse("tasks", "board"),
      proposalsViaBoard: s.reverse("proposals", "board"),
      checkpointsViaBoard: s.reverse("checkpoints", "board"),
      cursorsViaBoard: s.reverse("cursors", "board"),
      invitesViaBoard: s.reverse("boardInvites", "board"),
    },
  ),
  boardMembers: s.table(
    { boardId: s.uuid(), userId: s.uuid(), role: s.enum("viewer", "editor", "admin", "agent") },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "userId"]),
  boardInvites: s.table(
    {
      boardId: s.uuid(),
      // The token field stores only SHA-256, never a reusable invitation secret.
      token: s.string(),
      role: s.enum("viewer", "editor"),
      singleUse: s.boolean().default(false),
      expiresAtEpochMs: s.float().optional(),
      intendedUserId: s.uuid().optional(),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "token"]),
  shapes: s.table(
    {
      boardId: s.uuid(),
      kind: s.enum("note", "rect"),
      text: s.string(),
      // Set only by the private server after validating account and board role.
      authorId: s.uuid().optional(),
      authorName: s.string().optional(),
      x: s.float(),
      y: s.float(),
      width: s.float(),
      height: s.float(),
      fill: s.string(),
      zIndex: s.int(),
    },
    { board: s.rel("boards", "boardId"), tasksViaShape: s.reverse("tasks", "shape") },
  ).indexOnly(["boardId", "zIndex"]),
  /**
   * Canonical Dim0 board entities. JSON preserves note, applet, document,
   * folder, code-sandbox and link payloads without a lossy SQL projection.
   * All writes go through the authenticated Jazz service, never browser CRUD.
   */
  canvasEntities: s.table(
    {
      boardId: s.uuid(),
      kind: s.enum("node", "link"),
      payload: s.json(),
      version: s.int(),
      updatedBy: s.uuid(),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "kind"]),
  /** Backend-only idempotency receipt, committed atomically with the note. */
  mcpRequests: s.table(
    { boardId: s.uuid(), requestId: s.string(), textHash: s.string(), noteId: s.uuid() },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "requestId"]),
  tasks: s.table(
    {
      boardId: s.uuid(),
      shapeId: s.uuid().optional(),
      title: s.string(),
      notes: s.string().optional(),
      status: s.enum("todo", "doing", "review", "done"),
      rank: s.float(),
      assigneeId: s.uuid().optional(),
    },
    { board: s.rel("boards", "boardId"), shape: s.rel("shapes", "shapeId"), commentsViaTask: s.reverse("comments", "task") },
  ).indexOnly(["boardId", "status", "rank"]),
  comments: s.table(
    { taskId: s.uuid(), authorId: s.uuid(), body: s.string() },
    { task: s.rel("tasks", "taskId") },
  ).indexOnly(["taskId"]),
  cursors: s.table(
    { boardId: s.uuid(), userId: s.uuid(), name: s.string(), x: s.float(), y: s.float(), active: s.boolean().default(false) },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "userId"]),
  proposals: s.table(
    {
      boardId: s.uuid(),
      proposerId: s.uuid(),
      targetId: s.uuid().optional(),
      operation: s.enum("create_note", "move_shape", "create_task"),
      payload: s.json(),
      status: s.enum("pending", "approved", "rejected"),
      reviewedBy: s.uuid().optional(),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "status"]),
  checkpoints: s.table(
    { boardId: s.uuid(), label: s.string(), snapshot: s.json() },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId"]),
  agentRuns: s.table(
    {
      boardId: s.uuid(), agentId: s.uuid(), action: s.string(),
      status: s.enum("running", "complete", "failed"),
      input: s.json(), result: s.json().optional(),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId"]),
});

const { definePermissions, exists, anyOf, allOf, allowedTo, session } = schema;

const owned = (boardId: s.Uuid) => exists.boards({ id: boardId, ownerId: session.user });
const member = (boardId: s.Uuid) => anyOf(
  owned(boardId),
  exists.boardMembers({ boardId, userId: session.user }),
);
const editor = (boardId: s.Uuid) => anyOf(
  owned(boardId),
  exists.boardMembers({ boardId, userId: session.user, role: ["editor", "admin"] }),
);
const agentOrEditor = (boardId: s.Uuid) => anyOf(
  editor(boardId),
  exists.boardMembers({ boardId, userId: session.user, role: "agent" }),
);

export const permissions = definePermissions({
  boards: {
    read: true,
    insert: { ownerId: session.user },
    update: { ownerId: session.user },
    delete: { ownerId: session.user },
  },
  boardMembers: {
    read: (row) => member(row.boardId),
    insert: (row) => owned(row.boardId),
    update: (row) => owned(row.boardId),
    delete: (row) => owned(row.boardId),
  },
  boardInvites: {
    read: (row) => owned(row.boardId),
    insert: (row) => owned(row.boardId),
    update: false,
    delete: (row) => owned(row.boardId),
  },
  shapes: {
    read: true,
    insert: true,
    update: true,
    delete: true,
  },
  canvasEntities: {
    read: (row) => member(row.boardId),
    insert: false,
    update: false,
    delete: false,
  },
  mcpRequests: {
    // Only the trusted backend can inspect or create receipts.
    read: false,
    insert: false,
    update: false,
    delete: false,
  },
  tasks: {
    read: (row) => member(row.boardId),
    insert: (row) => editor(row.boardId),
    update: (row) => editor(row.boardId),
    delete: (row) => editor(row.boardId),
  },
  comments: {
    read: (row) => allowedTo.read(row.task),
    insert: (row) => allOf(allowedTo.read(row.task), { authorId: session.user }),
    update: false,
    delete: (row) => allowedTo.update(row.task),
  },
  cursors: {
    read: (row) => member(row.boardId),
    insert: (row) => allOf(member(row.boardId), { userId: session.user }),
    update: (row) => allOf(member(row.boardId), { userId: session.user }),
    delete: (row) => allOf(member(row.boardId), { userId: session.user }),
  },
  proposals: {
    read: (row) => member(row.boardId),
    insert: (row) => allOf(agentOrEditor(row.boardId), { proposerId: session.user }),
    update: (row) => editor(row.boardId),
    delete: (row) => owned(row.boardId),
  },
  checkpoints: {
    read: (row) => member(row.boardId),
    insert: (row) => owned(row.boardId),
    update: false,
    delete: false,
  },
  agentRuns: {
    read: (row) => member(row.boardId),
    insert: (row) => allOf(agentOrEditor(row.boardId), { agentId: session.user }),
    update: (row) => allOf(agentOrEditor(row.boardId), { agentId: session.user }),
    delete: false,
  },
});
