# Required Jazz-only domain parity matrix

**Hard requirement:** Jazz Tools is the canonical durable/synchronization layer for application business data, not merely a mirror of Dim0's SQL/Qdrant. This table is an honest status register.

| Domain entity / operation | Dim0 current authority | Patchboard Jazz counterpart | Migration state | Acceptance |
|---|---|---|---|---|
| Board identity/title/visibility | PostgreSQL graph, graph_user | `boards` + `boardMembers` | Patchboard source imported | all board APIs read Jazz |
| Members, private roles | PostgreSQL graph_user | `boardMembers` | Patchboard source imported | owner/editor/viewer/agent invariants |
| Invitations, share links | SQL graph_share_link | `boardInvites` + OAuth grants | Patchboard source imported | single-use, expiry and revocation tests |
| Standard notes | Qdrant Note payload | `canvasEntities` (new) + legacy `shapes` | Jazz CRUD implemented; Dim0 UI not wired | full geometry/content round trip |
| Rich documents/sheets | Qdrant Document payload | `canvasEntities.payload` | Core JSON covered, editing UI pending | Tiptap source / markdown intact |
| Folder/nested scope | GraphStore parentId | `canvasEntities.payload.parentId` | Basic storage only | subtree, cycles, scopes, move tests |
| Lines/edges | Qdrant Link | `canvasEntities(kind=link)` | Jazz CRUD implemented | endpoint positions and attachment preserved |
| Applets / JSX sources | Note content | `canvasEntities.payload.content` | Jazz CRUD implemented | render and edits sync across users |
| Legacy mini-app React | Note content + mini state SQL | `canvasEntities` plus state table required | JSX storage only | iframe runtime and state bridge |
| Code Sandbox source | Note content + Daytona | `canvasEntities` plus run records | Source payload only | run invocation, logs, permissions |
| Mini-applet state | IndexedDB or SQL | New `appletStates` design | Not done | multi-user/shared vs per-user semantics |
| Chat history/transcripts | PostgreSQL chat_transcript | New Jazz `chats/messages` tables | Not done | browser + backend agent history |
| Agent actions and runs | Mixed browser/server | `agentRuns` / `proposals` | Patchboard models imported | every action attributed and durable |
| Approvals and review | Browser confirmation + policy | `proposals` | Imported, integration pending | reviewer role and audit |
| Undo/revisions/checkpoints | PostgreSQL note_revision + local oplog | `checkpoints`, new `entityRevisions` | Imported checkpoints only | restore and concurrent edit semantics |
| Collaborative cursors/presence | WebSocket room + ephemeral | `cursors`, Jazz streams | Imported, Dim0 adapter pending | separate users see presence |
| Search and embeddings | Qdrant stored content | Jazz canonical text + derived in-memory index | Not done | queries include freshly edited nodes |
| Uploaded attachments/images | files + Document Store | Jazz-managed blobs/references (design) | Not done | binary integrity and access checks |
| Subscriptions/newsfeeds | SQL subscription stores | New Jazz tables | Not done | feed and subscriptions survive restart |
| Billing and entitlements | SQL user_billing | Jazz tables + payment provider boundary | Not done | entitlement checks without SQL reads |
| User profile/identity | SQL + Better Auth SQLite | Jazz user profile, identity-adapter research | Not done | passkeys and OAuth unaffected |
| OAuth sessions/grants | Better Auth SQLite (local) | Jazz identity adapter or durable security-state mapping | Not done | OAuth refresh/revoke after restart |
| Background tasks | Server processes / Redis | Jazz run state, no durable Redis authority | Not done | retry/idempotent/outbox |
| Event sequencing | PostgreSQL collab oplog | Jazz subscriptions and transactions | Not done | no dual origin, no lost events |

## Current Jazz schema and change

```text
boards
 ├── boardMembers (role/identity)
 ├── boardInvites (hashed one-use invitations)
 ├── shapes (legacy Patchboard note/rect)
 ├── canvasEntities (NEW: canonical full Dim0 node/link JSON)
 ├── tasks / comments
 ├── proposals / checkpoints / agentRuns
 ├── cursors
 └── mcpRequests (idempotency receipts for old create_note)
```

The new `canvasEntities` preserves full Dim0 JSON, but its `version` currently provides a compare-and-swap document revision, not a collaborative text CRDT. Every payload replacement from a client or MCP MUST use a current expected version. For high-frequency edits: add patch-oriented methods or Jazz CRDT granular fields; preserve concurrency correctness. Long text edits and code have different merge requirements from position updates.

**Do not remove old Patchboard `shapes` until a migration reconciles existing guest/private notes** to `canvasEntities` with stable IDs and references. A temporary dual-read reconciliation is acceptable; dual writes that establish two authorities are not.

## Auth and multi-tenancy

- Private browser clients may read authorized Jazz tables; they **cannot** write private `canvasEntities` directly. A verified private server translates browser/API/MCP intent to Jazz commands within authorization transactions.
- A read-only grant cannot list write tools or elevate role.
- The OAuth grant binds one board; the submitted `board_id` must match the grant AND current live membership.
- Source data `actorId`, `boardId`, `updatedBy`, `ownerId` are never accepted from untrusted payloads as authorization.
- User agents can propose changes under explicit roles; unlimited arbitrary code execution is out of scope of the basic MCP CRUD service.
- Accept-device-account and the anonymous guest demo MUST NOT provide any private-board authority.

## High-risk cutover edges

**Dim0 Postgres/Qdrant/Redis:** These dependencies remain in untouched Dim0 backend code. Remove or replace all production business-data write paths as a gated migration step. Start by listing route handlers and domain stores; write a failing test for each accidental SQL/Qdrant call under `DIM0_DATA_BACKEND=jazz`.

**Better Auth and strict Jazz-only:** The imported Patchboard implementation correctly uses local Better Auth SQLite for passkeys/OAuth. The strict mandate includes identity business data; changing the auth adapter is a separate research/test task. Do not casually replace its DB without a tested transaction and session storage adapter.

**Tailscale:** The existing Patchboard uses Tailscale Funnel for remote ChatGPT connections, with private OAuth. Funnel is public HTTPS; private tailnet-only IPs are not necessarily reachable from ChatGPT's service. Avoid accidentally exposing Jazz admin/inspector routes.

## Suggested priority

P0: Jazz-backed Dim0 nodes/links + MCP CRUD + auth (partially implemented).
P1: make Dim0 CanvasStore live Jazz-backed and remove its oplog writer for migrated boards.
P2: history, chats, applet states, uploads and derived search.
P3: identity migration, full native replacement of SQL stores, production cutover only after complete parity.
