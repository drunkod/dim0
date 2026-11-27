import { schema as s, migration as m } from "jazz-tools";

export default m.defineMigration({
  createTables: {
    "baseMemberships": true,
    "boardWorkspaceBindings": true,
    "workspaceAccountReceipts": true,
    "workspaceMemberships": true,
    "workspaceOwnerSets": true,
    "workspaces": true,
  },
  fromHash: "9d49ba9e8ab9",
  toHash: "039361478a64",
  from: {
  "appletStates": s.table({
    "boardId": s.uuid(),
    "noteId": s.uuid(),
    "value": s.json(),
    "version": s.int(),
    "updatedBy": s.uuid(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","noteId"]),
  "boardInvites": s.table({
    "boardId": s.uuid(),
    "token": s.string(),
    "role": s.enum("viewer", "editor"),
    "singleUse": s.boolean().default(false),
    "expiresAtEpochMs": s.float().optional(),
    "intendedUserId": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","token"]),
  "boardMembers": s.table({
    "boardId": s.uuid(),
    "userId": s.uuid(),
    "role": s.enum("viewer", "editor", "admin", "agent"),
    "roleVersion": s.int().default(1),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","userId"]),
  "boards": s.table({
    "title": s.string(),
    "ownerId": s.uuid(),
  }, {
    "membersViaBoard": s.reverse("boardMembers", "board"),
    "shapesViaBoard": s.reverse("shapes", "board"),
    "tasksViaBoard": s.reverse("tasks", "board"),
    "proposalsViaBoard": s.reverse("proposals", "board"),
    "checkpointsViaBoard": s.reverse("checkpoints", "board"),
    "cursorsViaBoard": s.reverse("cursors", "board"),
    "invitesViaBoard": s.reverse("boardInvites", "board"),
    "appletStatesViaBoard": s.reverse("appletStates", "board"),
  }),
  "checkpoints": s.table({
    "boardId": s.uuid(),
    "label": s.string(),
    "snapshot": s.json(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId"]),
  "comments": s.table({
    "taskId": s.uuid(),
    "authorId": s.uuid(),
    "body": s.string(),
  }, {
    "task": s.rel("tasks", "taskId"),
  }).indexOnly(["taskId"]),
  "cursors": s.table({
    "boardId": s.uuid(),
    "userId": s.uuid(),
    "name": s.string(),
    "x": s.float(),
    "y": s.float(),
    "active": s.boolean().default(false),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","userId"]),
  "proposals": s.table({
    "boardId": s.uuid(),
    "proposerId": s.uuid(),
    "targetId": s.uuid().optional(),
    "operation": s.enum("create_note", "move_shape", "create_task"),
    "payload": s.json(),
    "status": s.enum("pending", "approved", "rejected"),
    "reviewedBy": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","status"]),
  "shapes": s.table({
    "boardId": s.uuid(),
    "kind": s.enum("note", "rect"),
    "text": s.string(),
    "authorId": s.uuid().optional(),
    "authorName": s.string().optional(),
    "x": s.float(),
    "y": s.float(),
    "width": s.float(),
    "height": s.float(),
    "fill": s.string(),
    "zIndex": s.int(),
  }, {
    "board": s.rel("boards", "boardId"),
    "tasksViaShape": s.reverse("tasks", "shape"),
  }).indexOnly(["boardId","zIndex"]),
  "tasks": s.table({
    "boardId": s.uuid(),
    "shapeId": s.uuid().optional(),
    "title": s.string(),
    "notes": s.string().optional(),
    "status": s.enum("todo", "doing", "review", "done"),
    "rank": s.float(),
    "assigneeId": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
    "shape": s.rel("shapes", "shapeId"),
    "commentsViaTask": s.reverse("comments", "task"),
  }).indexOnly(["boardId","status","rank"])
},
  to: {
  "appletStates": s.table({
    "boardId": s.uuid(),
    "noteId": s.uuid(),
    "value": s.json(),
    "version": s.int(),
    "updatedBy": s.uuid(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","noteId"]),
  "baseMemberships": s.table({
    "workspaceId": s.uuid(),
    "boardId": s.uuid(),
    "actorId": s.uuid(),
    "role": s.enum("creator", "editor", "commenter", "viewer"),
    "state": s.enum("active", "disabled").default("active"),
    "version": s.int().default(1),
  }, {
    "workspace": s.rel("workspaces", "workspaceId"),
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","actorId"]),
  "boardInvites": s.table({
    "boardId": s.uuid(),
    "token": s.string(),
    "role": s.enum("viewer", "editor"),
    "singleUse": s.boolean().default(false),
    "expiresAtEpochMs": s.float().optional(),
    "intendedUserId": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","token"]),
  "boardMembers": s.table({
    "boardId": s.uuid(),
    "userId": s.uuid(),
    "role": s.enum("viewer", "editor", "admin", "agent"),
    "roleVersion": s.int().default(1),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","userId"]),
  "boards": s.table({
    "title": s.string(),
    "ownerId": s.uuid(),
  }, {
    "membersViaBoard": s.reverse("boardMembers", "board"),
    "shapesViaBoard": s.reverse("shapes", "board"),
    "tasksViaBoard": s.reverse("tasks", "board"),
    "proposalsViaBoard": s.reverse("proposals", "board"),
    "checkpointsViaBoard": s.reverse("checkpoints", "board"),
    "cursorsViaBoard": s.reverse("cursors", "board"),
    "invitesViaBoard": s.reverse("boardInvites", "board"),
    "appletStatesViaBoard": s.reverse("appletStates", "board"),
  }),
  "boardWorkspaceBindings": s.table({
    "boardId": s.uuid(),
    "workspaceId": s.uuid(),
    "version": s.int().default(1),
  }, {
    "board": s.rel("boards", "boardId"),
    "workspace": s.rel("workspaces", "workspaceId"),
  }).indexOnly(["boardId"]),
  "checkpoints": s.table({
    "boardId": s.uuid(),
    "label": s.string(),
    "snapshot": s.json(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId"]),
  "comments": s.table({
    "taskId": s.uuid(),
    "authorId": s.uuid(),
    "body": s.string(),
  }, {
    "task": s.rel("tasks", "taskId"),
  }).indexOnly(["taskId"]),
  "cursors": s.table({
    "boardId": s.uuid(),
    "userId": s.uuid(),
    "name": s.string(),
    "x": s.float(),
    "y": s.float(),
    "active": s.boolean().default(false),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","userId"]),
  "proposals": s.table({
    "boardId": s.uuid(),
    "proposerId": s.uuid(),
    "targetId": s.uuid().optional(),
    "operation": s.enum("create_note", "move_shape", "create_task"),
    "payload": s.json(),
    "status": s.enum("pending", "approved", "rejected"),
    "reviewedBy": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
  }).indexOnly(["boardId","status"]),
  "shapes": s.table({
    "boardId": s.uuid(),
    "kind": s.enum("note", "rect"),
    "text": s.string(),
    "authorId": s.uuid().optional(),
    "authorName": s.string().optional(),
    "x": s.float(),
    "y": s.float(),
    "width": s.float(),
    "height": s.float(),
    "fill": s.string(),
    "zIndex": s.int(),
  }, {
    "board": s.rel("boards", "boardId"),
    "tasksViaShape": s.reverse("tasks", "shape"),
  }).indexOnly(["boardId","zIndex"]),
  "tasks": s.table({
    "boardId": s.uuid(),
    "shapeId": s.uuid().optional(),
    "title": s.string(),
    "notes": s.string().optional(),
    "status": s.enum("todo", "doing", "review", "done"),
    "rank": s.float(),
    "assigneeId": s.uuid().optional(),
  }, {
    "board": s.rel("boards", "boardId"),
    "shape": s.rel("shapes", "shapeId"),
    "commentsViaTask": s.reverse("comments", "task"),
  }).indexOnly(["boardId","status","rank"]),
  "workspaceAccountReceipts": s.table({
    "workspaceId": s.uuid(),
    "actorId": s.uuid(),
    "operation": s.enum("legacy_backfill", "owner_transfer"),
    "requestId": s.string(),
    "fingerprint": s.string(),
    "committedVersion": s.int(),
    "result": s.json(),
  }, {
    "workspace": s.rel("workspaces", "workspaceId"),
  }).indexOnly(["workspaceId","actorId","requestId"]),
  "workspaceMemberships": s.table({
    "workspaceId": s.uuid(),
    "actorId": s.uuid(),
    "role": s.enum("owner", "creator", "editor", "commenter", "viewer"),
    "state": s.enum("active", "disabled").default("active"),
    "version": s.int().default(1),
    "proof": s.enum("legacy_private_owner", "verified_better_auth"),
  }, {
    "workspace": s.rel("workspaces", "workspaceId"),
  }).indexOnly(["workspaceId","actorId"]),
  "workspaceOwnerSets": s.table({
    "workspaceId": s.uuid(),
    "version": s.int(),
    "ownerActorIds": s.json(),
  }, {
    "workspace": s.rel("workspaces", "workspaceId"),
  }).indexOnly(["workspaceId"]),
  "workspaces": s.table({
    "name": s.string(),
    "createdBy": s.uuid(),
    "state": s.enum("active", "disabled").default("active"),
  }, {

  })
},
});
