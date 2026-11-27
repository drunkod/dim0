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
      appletStatesViaBoard: s.reverse("appletStates", "board"),
    },
  ),
  /**
   * PR1 additive Teable Space equivalent. These rows only supply shadow
   * ancestry until a verified live policy rollout; old boards keep their
   * exact ownerId and native membership authorization.
   */
  workspaces: s.table({
    name: s.string(), createdBy: s.uuid(),
    state: s.enum("active", "disabled").default("active"),
  }),
  /**
   * Exactly one binding per legacy board, enforced by using boardId as the
   * binding row's deterministic primary ID in the server-only backfill.
   */
  boardWorkspaceBindings: s.table({
    boardId: s.uuid(), workspaceId: s.uuid(),
    version: s.int().default(1),
  }, {
    board: s.rel("boards", "boardId"),
    workspace: s.rel("workspaces", "workspaceId"),
  }).indexOnly(["boardId"]),
  workspaceMemberships: s.table({
    workspaceId: s.uuid(), actorId: s.uuid(),
    role: s.enum("owner", "creator", "editor", "commenter", "viewer"),
    state: s.enum("active", "disabled").default("active"),
    version: s.int().default(1),
    proof: s.enum("legacy_private_owner", "verified_better_auth"),
  }, {
    workspace: s.rel("workspaces", "workspaceId"),
  }).indexOnly(["workspaceId", "actorId"]),
  /**
   * No independently assignable Base Owner. Legacy agent/admin roles
   * remain ONLY in the old boardMembers table pending compatibility proof.
   */
  baseMemberships: s.table({
    workspaceId: s.uuid(), boardId: s.uuid(), actorId: s.uuid(),
    role: s.enum("creator", "editor", "commenter", "viewer"),
    state: s.enum("active", "disabled").default("active"),
    version: s.int().default(1),
    // Shadow lineage only. Old and independent Base rows lack this value and
    // MUST NOT be treated as current copies of legacy boardMembers.
    legacyMemberId: s.uuid().optional(),
  }, {
    workspace: s.rel("workspaces", "workspaceId"),
    board: s.rel("boards", "boardId"),
  }).indexOnly(["boardId", "actorId"]),
  /**
   * One serialized workspace owner-set CAS conflict point, not independent
   * owner membership writes. No external transfer API is enabled in PR1.
   */
  workspaceOwnerSets: s.table({
    workspaceId: s.uuid(), version: s.int(),
    ownerActorIds: s.json(),
  }, { workspace: s.rel("workspaces", "workspaceId") }).indexOnly(["workspaceId"]),
  workspaceAccountReceipts: s.table({
    workspaceId: s.uuid(), actorId: s.uuid(),
    operation: s.enum("legacy_backfill", "owner_transfer"),
    requestId: s.string(), fingerprint: s.string(),
    committedVersion: s.int(), result: s.json(),
  }, { workspace: s.rel("workspaces", "workspaceId") })
    .indexOnly(["workspaceId", "actorId", "requestId"]),
  boardMembers: s.table(
    {
      boardId: s.uuid(), userId: s.uuid(),
      role: s.enum("viewer", "editor", "admin", "agent"),
      // Native member-role CAS: existing rows migrate to version 1.
      roleVersion: s.int().default(1),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "userId"]),
  /**
   * Immutable server-only role mutation receipts + sanitized audit.
   * Single Jazz transaction must check current owner, role/expectedVersion,
   * update boardMembers and write this receipt. No email/mailbox PII.
   */
  boardMemberRoleReceipts: s.table(
    {
      boardId: s.uuid(), memberId: s.uuid(), actorId: s.uuid(),
      requestId: s.string(), fingerprint: s.string(),
      previousRole: s.enum("viewer", "editor"),
      assignedRole: s.enum("viewer", "editor"),
      membershipVersion: s.int(), changed: s.boolean(),
    },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "actorId", "requestId"]),
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
  /**
   * ACC-051 canvas field-patch receipts/events are backend-only. The receipt
   * stores the committed vN snapshot for safe lost-response replay; the event
   * carries one sanitized attribution for each actual mutation. Both insert
   * in the SAME serializable Jazz transaction as the canvas entity update.
   */
  canvasPatchReceipts: s.table({
    boardId: s.uuid(), entityId: s.uuid(), actorId: s.uuid(),
    requestId: s.string(), fingerprint: s.string(),
    previousVersion: s.int(), committedVersion: s.int(),
    committedPayload: s.json(), eventId: s.uuid(),
  }, { board: s.rel("boards", "boardId") })
    .indexOnly(["boardId", "actorId", "requestId"]),
  canvasPatchEvents: s.table({
    boardId: s.uuid(), entityId: s.uuid(), actorId: s.uuid(),
    requestId: s.string(), receiptId: s.uuid(),
    previousVersion: s.int(), committedVersion: s.int(),
    field: s.enum("label.markdown"),
  }, { board: s.rel("boards", "boardId") })
    .indexOnly(["boardId", "entityId"]),
  /**
   * QA-gated first TYPED relational-record vertical slice. Separate from
   * Dim0 Canvas JSON and its receipt namespace. All five tables are backend-
   * owned, never raw browser Jazz CRUD. No inherited live write activation.
   */
  typedDatasets: s.table({
    boardId: s.uuid(), name: s.string(), schemaVersion: s.int(),
    state: s.enum("active","read_only").default("active"),
  }, {board:s.rel("boards","boardId")}).indexOnly(["boardId"]),
  typedFields: s.table({
    boardId: s.uuid(), datasetId: s.uuid(), name: s.string(),
    kind: s.enum("text","computed"),
    computeFromFieldId: s.uuid().optional(),
  }, {
    board:s.rel("boards","boardId"),
    dataset:s.rel("typedDatasets","datasetId"),
  }).indexOnly(["datasetId"]),
  typedRecords: s.table({
    boardId: s.uuid(), datasetId: s.uuid(),
    cells: s.json(), version:s.int(), updatedBy:s.uuid(),
  }, {
    board:s.rel("boards","boardId"),
    dataset:s.rel("typedDatasets","datasetId"),
  }).indexOnly(["datasetId"]),
  typedPatchReceipts: s.table({
    boardId:s.uuid(), datasetId:s.uuid(), recordId:s.uuid(),
    actorId:s.uuid(), requestId:s.string(), fingerprint:s.string(),
    schemaVersion:s.int(), previousVersion:s.int(), committedVersion:s.int(),
    committedCells:s.json(), eventId:s.uuid(),
  }, {
    board:s.rel("boards","boardId"),
    dataset:s.rel("typedDatasets","datasetId"),
  }).indexOnly(["boardId","actorId","requestId"]),
  typedPatchEvents: s.table({
    boardId:s.uuid(), datasetId:s.uuid(), recordId:s.uuid(),
    actorId:s.uuid(), requestId:s.string(), receiptId:s.uuid(),
    previousVersion:s.int(), committedVersion:s.int(),
    fieldIds:s.json(),
  }, {
    board:s.rel("boards","boardId"),
    dataset:s.rel("typedDatasets","datasetId"),
  }).indexOnly(["boardId","recordId"]),
  /** Per-applet shared runtime state, separate from versioned Canvas geometry.
   * Serializability and optimistic CAS prevent lost counter updates. */
  appletStates: s.table(
    { boardId: s.uuid(), noteId: s.uuid(), value: s.json(),
      version: s.int(), updatedBy: s.uuid() },
    { board: s.rel("boards", "boardId") },
  ).indexOnly(["boardId", "noteId"]),
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
  // Guest/demo clients NEVER see or write private account or Space ancestry.
  workspaces: { read: false, insert: false, update: false, delete: false },
  boardWorkspaceBindings: { read: false, insert: false, update: false, delete: false },
  workspaceMemberships: { read: false, insert: false, update: false, delete: false },
  baseMemberships: { read: false, insert: false, update: false, delete: false },
  workspaceOwnerSets: { read: false, insert: false, update: false, delete: false },
  workspaceAccountReceipts: { read: false, insert: false, update: false, delete: false },
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
  boardMemberRoleReceipts: {
    read: false, insert: false, update: false, delete: false,
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
  canvasPatchReceipts: { read: false, insert: false, update: false, delete: false },
  canvasPatchEvents: { read: false, insert: false, update: false, delete: false },
  typedDatasets: { read: false, insert: false, update: false, delete: false },
  typedFields: { read: false, insert: false, update: false, delete: false },
  typedRecords: { read: false, insert: false, update: false, delete: false },
  typedPatchReceipts: { read: false, insert: false, update: false, delete: false },
  typedPatchEvents: { read: false, insert: false, update: false, delete: false },
  appletStates: {
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
