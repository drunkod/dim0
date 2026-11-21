# Patchboard MVP · historical review draft

> **Historical planning reference (superseded for the immediate demo).** M1 has since been implemented. The approved next milestone is **direct `create_note` through a no-auth ChatGPT.com remote MCP plugin over Tailscale Funnel**, without mandatory proposal review. Follow [the current English architect brief](ARCHITECT_BRIEF_CHATGPT_MCP.md), [M2 start assignment](M2_START.md) and [current roadmap](ROADMAP.md). Retain the research references below; do not treat its older milestone sequence, stdio-only transport or estimates as current instructions.

## Proposed release

Build one complete interaction first. Two people edit a shared note, an agent reads it and suggests another, and a person decides whether to publish the suggestion. The end point is a developer-run demonstration with sample data.

## Changes to the earlier review

Replace sign-in and invite setup with seeded participants. Bring the two-browser sync proof and real MCP connection to the front. Keep acceptance, rejection, retry handling and reconnect because they determine what a user actually sees. Move the security review and all its release gates to a separate backlog.

## Architecture and scope

Keep Foldkit for UI state, Effect for commands and Jazz for shared data. Use the existing note shape and keyboard movement controls. Deliver create, edit and move on a single board. Keep board and proposal subscriptions scoped to that board. Preserve pending input if a save fails and distinguish local persistence from confirmation by the sync server.

Use a local seed command once per demo to prepare predictable participants, memberships and sample data. First verify that the pinned Jazz runtime supports the fixture sessions across independent profiles. If setup stalls, proceed with the note editor and proposal UI against fixtures while isolating the sync problem. M1 still requires a real remote peer update between profiles.

Use one local MCP adapter and the existing Jazz store. The agent reads the board and proposes a note with a request ID. A person decides whether the suggestion belongs on the board. Keep this interaction because it is the product workflow. Record the decision for display and use a stable proposal ID to prevent duplicate notes on retry. For simultaneous decisions, verify the installed Jazz transaction API resolves the race to a single committed outcome.

## Implementation roadmap

| Milestone | Work | Demonstration |
|---|---|---|
| M1 · Shared note | Start the pinned Jazz sync runtime locally. Seed one board and the fixture memberships required by existing policies. Open two independent browser profiles. | Create a note in A, edit and move it in B, then reopen both. Both show the same text and position. |
| M2 · Agent suggestion | Connect one desktop MCP client over stdio. Expose read_board and propose_note. Store the suggestion in Jazz and display its text on the board. | The real client reads the note from M1 and suggests a follow-up. Both browsers see the pending suggestion. |
| M3 · Human decision | Add Accept and Reject in Foldkit. Use one Jazz transaction for the decision and resulting note. Give submissions and decisions stable IDs. | Accept creates exactly one note, including after a retry or two simultaneous clicks. Reject creates zero. Reopening preserves the outcome. |
| M4 · Demo rehearsal | Exercise cold start, reconnect, error feedback and keyboard use. Add a repeatable fixture reset and short run instructions. | Starting from a fresh fixture, two people complete the workflow with the actual MCP client. A disconnected browser catches up when it reconnects. |

## Ticket changes from the previous roadmap

| Original ticket | New placement |
|---|---|
| PB-001, PB-004 | Reuse the existing scaffold, UI and checks. Add editing and save feedback in M1. |
| PB-002, PB-003, PB-005 | M1 covers the schema needed for the demo, shared runtime, seeded participants and live updates. Move production identity and policy work to the deferred backlog. |
| PB-006 | Defer invitations and revocation. |
| PB-007, PB-008 | Revisit presence, task workflow and comments after observing the demo. |
| PB-009, PB-010 | Move MCP read/propose and human decisions to M2–M3. Defer security audit logging. |
| PB-011 | Defer named checkpoints. |
| PB-012 | Start two-profile testing in M1 and finish reconnect and demo rehearsal in M4. Schedule hosted rollout separately. |

**Planning estimate:** allow roughly 4–6 focused engineering days for one engineer with the pinned runtime and a compatible desktop MCP client available. Budget 1–2 days for M1, one each for M2 and M3, and 1–2 for M4. Re-estimate after the two-profile sync proof.

## Deferred security backlog

Park these items together for a later release decision. None is an MVP ticket, dependency, acceptance test or sign-off.

- Staff sign-in, account lifecycle, invitations, token expiry and revocation.
- Production roles, board isolation, agent credential provisioning and backend authorization review.
- Policy corrections and denial tests, including reader comment insertion, proposal initial status, reviewer identity and immutable audit evidence.
- Credential management for hosted MCP, abuse controls, rate limits, security telemetry and deployment hardening.

The MVP milestone demonstrates the workflow in a developer-run environment using sample boards. Wider distribution and the security backlog can be scheduled separately. Existing policy definitions stay in place; fixtures use the memberships they already require.

## After the MVP

Choose the next product increment from observed use. Add assignment and status first if handoff is the problem. Add comments if decisions need discussion, presence if people lose track of each other, and named checkpoints if teams need to revisit an earlier board. Revisit hosted MCP when a pilot user needs a remote client.

## Implementation references

Start with PosterShop's sharing and canvas patterns, StagePlan's Effect model and MusicAgent's tool validation. The following index carries forward the project's 21 pinned Jazz references and CAFE examples. The original project index records its file-range verification. The file ranges were not individually revalidated in this review.

| Application | Feature | Source snippet | Adaptation |
|---|---|---|---|
| PosterShop | Canvas schema + layers | [Source lines 4–101](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/schema.ts#L4-L101) | Board/layer/shape relations, z-order, geometry, assets |
| PosterShop | React live shape editor | [Source lines 82–105](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/components/CanvasSurface.tsx#L82-L105) | useAll live subscriptions; row updates |
| PosterShop | Create and delete shapes | [Source lines 184–240](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/components/CanvasSurface.tsx#L184-L240) | Shape mutations synchronized through Jazz |
| PosterShop | Collaborator cursors | [Source lines 17–99](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/components/CollaboratorCursors.tsx#L17-L99) | Independently subscribed presence, coalesced at 50 ms |
| PosterShop | Row-level canvas permissions | [Source lines 134–180](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/schema.ts#L134-L180) | Server-enforced member/editor/admin rules and locked layers |
| PosterShop | Invite link UI | [Source lines 30–52](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/components/InviteDialog.tsx#L30-L52) | Role-based invitation creation and management |
| PosterShop | Redeem invite safely | [Source lines 19–41](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/lib/join.ts#L19-L41) | Serializable membership admission, single-use tokens |
| BandBook | Page/subtree sharing | [Source lines 28–51](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/band-book/apps/nextjs-betterauth/src/components/ShareDialog.tsx#L28-L51) | Read/edit grants inherited by linked content |
| StagePlan | Staff kanban task board | [Source lines 26–90](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/stage-plan/apps/react-localfirst/src/components/Board.tsx#L26-L90) | Drag and keyboard task columns |
| StagePlan | Tasks + audit events | [Source lines 154–189](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/stage-plan/apps/react-localfirst/src/model/actions.ts#L154-L189) | Transactional task, move, assignment and activity records |
| StagePlan | Concurrent task notes | [Source lines 198–207](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/stage-plan/apps/react-localfirst/src/model/actions.ts#L198-L207) | Merge concurrent text edits with editedFrom |
| StagePlan | Comment activity | [Source lines 217–229](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/stage-plan/apps/react-localfirst/src/model/actions.ts#L217-L229) | Task discussion and audit events |
| BandChat | Offline chat & attachments | [Source lines 68–111](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/band-chat/apps/nextjs-betterauth/src/components/Composer.tsx#L68-L111) | Local-first messages and binary attachments |
| PosterShop | Immutable named checkpoints | [Source lines 35–60](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/poster-shop/apps/nextjs-betterauth/src/components/CheckpointShelf.tsx#L35-L60) | Saved visual snapshots separate from cursor traffic |
| Branching planner | Draft scenarios/branches | [Source lines 30–57](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/branching-project-planner-ts/src/main.ts#L30-L57) | Capture snapshot, establish draft branch/base view |
| Branching planner | Branch permission model | [Source lines 18–49](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/branching-project-planner-ts/schema.ts#L18-L49) | branchBy and write only while scenario open |
| MusicAgent | Validated agent tool definitions | [Source lines 19–103](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/music-agent/apps/nextjs/src/agent/tools.ts#L19-L103) | Typed allowlist and validated model tool input |
| MusicAgent | Auditable/resumable agent actions | [Source lines 290–355](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/music-agent/apps/nextjs/src/agent/runner.ts#L290-L355) | Tool-call status rows, idempotent replay, execution lease |
| EpicDrop | Stream attachments | [Source lines 25–55](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/examples/epic-drop/src/large-values.ts#L25-L55) | Stream file bytes without buffering whole file |
| Official Jazz docs | Inspector MCP access | [Source lines 76–106](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/docs/content/docs/tooling/inspector.mdx#L76-L106) | Approved time-limited MCP access, privileged inspector scope |
| Official Jazz docs | Backend identity for agents | [Source lines 12–78](https://github.com/garden-co/jazz/blob/802e919f3b81f3e1b71aa5279cc799b570b8c9af/docs/content/docs/setup/backend-client.mdx#L12-L78) | Configure scoped machine clients, normal row policies |

## CAFE / Effect / Foldkit development conventions

| Responsibility | Pinned code |
|---|---|
| Coding agent workflow / TDD | [CAFE AGENTS.md](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/AGENTS.md) |
| Foldkit Model/Message/update/View and streams | [CAFE frontend main.ts](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/packages/frontend/src/main.ts) |
| Foldkit runtime startup | [CAFE entry.ts](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/packages/frontend/src/entry.ts) |
| Foldkit Story tests | [CAFE story.test.ts](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/packages/frontend/src/story.test.ts) |
| Foldkit Scene tests | [CAFE scene.test.ts](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/packages/frontend/src/scene.test.ts) |
| Cloudflare + Alchemy deployment example | [CAFE alchemy.run.ts](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/alchemy.run.ts) |
| Test + preview CI | [CAFE ci.yml](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.github/workflows/ci.yml) |
| Foldkit coding-agent skill | [CAFE foldkit skill](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.agents/skills/foldkit/SKILL.md) |
| Program generation / audit | [CAFE generate skill](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.agents/skills/generate-program/SKILL.md) / [audit skill](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.agents/skills/audit-program/SKILL.md) |

## New Jazz / Effect-specific starting points

- [Jazz Effect service guide](https://jazz.tools/docs/recipes/effect) — Jazz.layer, stream, transaction, durability, backend user scope.
- [Jazz StagePlan TypeScript+Effect model](https://github.com/garden-co/jazz/tree/main/examples/stage-plan/apps/ts-effect-betterauth/src/model.ts) — transaction-backed tasks and Effect.fn patterns.
- [Jazz StagePlan Effect streaming planner](https://github.com/garden-co/jazz/tree/main/examples/stage-plan/apps/ts-effect-betterauth/src/planner.ts) — stream scope cleanup.
- [Jazz Effect docs snippets](https://github.com/garden-co/jazz/tree/main/examples/docs/todo-effect/src/docs-snippets.ts) — Jazz service all/one, Stream, transaction, typed errors.
- [Jazz own-server deployment](https://jazz.tools/docs/setup/deployment/own-server) — real shared persistence and user authentication.
- [Jazz Inspector/MCP](https://jazz.tools/docs/tooling/inspector) — privileged developer-only inspection; not a normal agent ACL.
- [Jazz collaborative list](https://jazz.tools/docs/recipes/data-patterns/real-time-collaborative-list) — online/offline and concurrent changes.
- [Foldkit canonical source](https://github.com/foldkit/foldkit) — APIs and idioms pinned locally at foldkit@0.165.0.
