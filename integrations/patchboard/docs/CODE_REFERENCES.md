# Source code reference index — 21 verified Jazz snippets

The source links below are pinned to the Jazz commit cloned at /Users/test/work/patchwork/jazz. All 21 file paths and line ranges were verified in the earlier research pass.

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

## Effect 4 best-practice references (current project standard)

For mandatory coding/review expectations, see the [Effect TS 4 practices](EFFECT_TS_PRACTICES.md) alongside the [original CAFE development cycle](DEVELOPMENT_CYCLE.md). Useful *official v4* sources include [generators](https://effect.website/docs/v4/getting-started/using-generators), [typed expected errors](https://effect.website/docs/v4/error-management/expected-errors), [services and Layers](https://effect.website/docs/v4/requirements-management/layers), [resource scopes](https://effect.website/docs/v4/resource-management/scope), [runtime boundaries](https://effect.website/docs/v4/getting-started/running-effects), [bounded concurrency](https://effect.website/docs/v4/concurrency/basic-concurrency), and [TestClock](https://effect.website/docs/v4/testing/testclock). They complement, **not replace**, the pinned CAFE/Foldkit and Jazz example commits below.

## New Jazz / Effect-specific starting points

- [Jazz Effect service guide](https://jazz.tools/docs/recipes/effect) — Jazz.layer, stream, transaction, durability, backend user scope.
- [Jazz StagePlan TypeScript+Effect model](https://github.com/garden-co/jazz/tree/main/examples/stage-plan/apps/ts-effect-betterauth/src/model.ts) — transaction-backed tasks and Effect.fn patterns.
- [Jazz StagePlan Effect streaming planner](https://github.com/garden-co/jazz/tree/main/examples/stage-plan/apps/ts-effect-betterauth/src/planner.ts) — stream scope cleanup.
- [Jazz Effect docs snippets](https://github.com/garden-co/jazz/tree/main/examples/docs/todo-effect/src/docs-snippets.ts) — Jazz service all/one, Stream, transaction, typed errors.
- [Jazz own-server deployment](https://jazz.tools/docs/setup/deployment/own-server) — real shared persistence and user authentication.
- [Jazz Inspector/MCP](https://jazz.tools/docs/tooling/inspector) — privileged developer-only inspection; not a normal agent ACL.
- [Jazz collaborative list](https://jazz.tools/docs/recipes/data-patterns/real-time-collaborative-list) — online/offline and concurrent changes.
- [Foldkit canonical source](https://github.com/foldkit/foldkit) — APIs and idioms pinned locally at foldkit@0.165.0.

## Previously published Classic Jazz examples are NOT drop-in

Older examples under https://classic.jazz.tools/examples use the pre-2.0 CoValue/Group APIs. We can inspect their UX ideas but should not port them as direct package code.
