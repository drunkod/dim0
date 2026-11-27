# Programmer assignment for authenticated Patchboard collaboration

20–21 November 2026 • Start in the existing auth worktree • One board, two Patchboard accounts, two ChatGPT connections

**Decision.** Keep Foldkit, Effect, Jazz SQLite and the existing Streamable HTTP tools. Use Better Auth passkeys and per-user authorization-code grants with S256 PKCE on the MacBook. A passkey authenticates a website session. The OAuth grant authorizes a separate ChatGPT connection to act for that Patchboard user on an approved board. The displayed identity means “signed in as this Patchboard account”; it does not certify a legal name or email.

**Estimate for one engineer familiar with the stack:** 24–40 focused hours for the complete, rehearsed scenario, assuming both ChatGPT accounts can install a custom integration and approve writes. The estimate includes the acceptance gates below. Workspace approvals and availability of the second person are additional elapsed time. **No-go on promising the complete scenario tomorrow.** Conditional target for one day: two passkey users, one private board and a verified browser-authored note, with outsider denial. If per-user OAuth also works, advance to two authenticated SDK clients and then two real ChatGPT accounts. Schedule people and devices now.

## 1. Establish the baseline and clear the first failure · 1–2 hours

1. Ask the current developer to confirm ownership of the uncommitted diff before editing. Use the existing auth worktree. Keep the public guest process on 8791, its build directory and its database separate. Keep M1 on 3001/4173. Use a new private demo root containing separate auth and Jazz stores, separate frontend build and an available loopback port (candidate 8792). Check the listener first.
2. Record commit, diff, Funnel mappings, current board ID and baseline health. Preserve the guest restart procedure in `docs/M2_PUBLIC_FUNNEL_RELEASE.md`. Never run private schema generation against the guest data. Use the pinned reference Git objects so unrelated local edits in RemoteMCP-Jazz cannot enter the patch.
3. Run these from the MacBook. The first two test commands below are existing commands. Inspect the saved trace from the prior run before rerunning the suite; it timed out on owner-page reload at `apps/web/browser/shared-board.spec.ts:40`. Reproduce on isolated ports, identify the actual readiness condition and retain a trace. Do not declare this a flaky test on a single rerun.

```sh
cd /Users/test/work/patchwork/agent-staff-board-auth
git status --short --branch
git diff -- apps/server/src/board-service.ts apps/server/test/mcp-board.test.mjs
tailscale funnel status
curl -fsS http://127.0.0.1:8791/health
lsof -nP -iTCP:8792 -sTCP:LISTEN
pnpm test:mcp
PATCHBOARD_TEST_PORT=44181 PATCHBOARD_TEST_JAZZ_PORT=43181 pnpm verify
```

**Exit evidence:** guest health, route map, private DB paths, green baseline or an explicitly assigned regression. Confirm A and B can each access ChatGPT's connector setup and write actions, and that each has a passkey-capable browser. C needs an unrelated Patchboard account. Arrange a viewer account and one cellular/off-tailnet client.

## 2. Bring up two real website identities · 4–6 hours

**PR 1.** Adapt the committed RemoteMCP-Jazz auth plugin assembly, auth-db, passkey enrollment intent and session setup at `fae173e`. Its manifest pins Better Auth, passkey, MCP, OAuth provider and CIMD packages at **1.7.1**. Use these as the candidate family and verify compatibility in the isolated lockfile. Patchboard pins MCP SDK **1.29.0**, Jazz **2.0.0-alpha.69**, Effect **4.0.0** and Foldkit **0.165.0**. The reference uses MCP server **2.0.0** and Jazz **alpha.53**. Adapt the Node request/response boundary; leave Next.js pages, Next cookie glue and the device grant out of this slice.

1. Add a private entry point next to `apps/server/src/demo.ts`. Require a configured canonical HTTPS origin, stable secrets and distinct database paths. Fail startup if it selects the guest database or permissive device-account mode. Run provider migrations before resource seeding; enable foreign keys and persist keys and sessions across restart. Store secrets outside Git. Exercise backup and restore using scratch copies.
2. Add Foldkit registration, login and sign-out commands. Use the provider's server-issued, expiring enrollment intent, verified WebAuthn challenge and user verification. Bind each challenge to its session, account and operation. Set the RP ID to the hostname and allowed origin to the exact HTTPS origin. The RP ID has no scheme, port or path. Never let an unauthenticated request attach a credential to an existing account by choosing its display name. Protect state-changing cookie requests against CSRF.
3. Use a stable Patchboard UUID as the provider ID if supported, otherwise persist a unique mapping from (issuer, subject) to Patchboard UUID. Use the same mapping for the Jazz browser session and the OAuth bearer. Keep the account's display label editable separately. A grant records the board approved at consent. Reauthorization is required for a different board in this slice.
4. Start tests with two fresh browser profiles. Register A and B separately; prove different account IDs, stable IDs after restart, rejected replay and session expiry. Verify signing out clears any visible board and isolates the Jazz client cache before another person uses the same browser. Check wrong-origin challenges fail.

## 3. Secure the board and Jazz synchronization · 4–7 hours

**PR 2, depends on stable identity.** `apps/server/src/http-server.ts` passes `acceptDeviceAccounts`; `apps/web/src/main.ts` starts a device client. In private mode supply the Jazz alpha.69 authentication adapter with a verified, expiring identity tied to the Patchboard account. Adapt Jamroom-Jazz's server-side session bridge. Verify the actual credential transport for HTTP and browser WebSocket upgrade in the installed SDK. Handle expiry, reconnect and revocation for already-open subscriptions. An Origin header or successful 101 alone proves no board permission.

1. Reuse `boards.ownerId` and `boardMembers` in `packages/jazz-schema/schema.ts`. The owner is the matching owner UUID. Only the owner grants Editor or Viewer. Reserve existing admin/agent roles for legacy data with explicit migration decisions; never grant them via a new invite. A member can read, an editor can create/edit permitted notes, a viewer can only read. On the private schema remove unrestricted `boards.read` and all unrestricted shape operations. Prevent changes to boardId, owner, author and membership through generic client writes. Where the DSL cannot enforce immutable fields, route those mutations through checked server operations and deny raw mutations.
2. Audit other subscribed tables, reverse relations and generic browser mutation paths, including comments/cursors/proposals. For the narrow private demo deny unused operations. Keep receipts, credentials and invite material out of client subscriptions. Generate schema and permission outputs from TypeScript; migrate a copy of a previous DB and start it twice.
3. Seed a private board owned by A. Start with explicit membership for B to isolate the Jazz gate from invitation bugs. Run positive owner/editor/viewer reads and editor write, then viewer denial, C denial and unauthenticated denial via the actual Jazz client over HTTP/WSS. Check no snapshot or incremental note reaches C when someone writes. Revoke B during a subscription and test reconnect; a client that already saw information cannot be made to forget it, but it must receive no further private updates.

## 4. Add owner invitations and trustworthy authorship · 4–6 hours

**PR 3, depends on private board policy.** Reuse Jamroom-Jazz invite and join handlers at `3b68f99`. Extend `boardInvites` with token digest, expiry, consumption and optional intended recipient. Mint a random, single-use secret server-side; store only its digest. Return the link to the owner once, redact secrets in logs, and redeem only following an explicit signed-in POST. A link preview or GET must not consume it. Accept only Editor or Viewer, check issuing owner authority, and use one serializable Jazz transaction to validate the token, establish unique membership and mark it used. An existing viewer cannot promote themselves by editing the request.

Migrate shapes to optional immutable `authorId`. Use a server-managed profile label associated with an authorized visible author. Give old authorless notes the label “Guest / unverified”. Preserve historical rows and IDs. Add attribution to `readBoard`, the Foldkit snapshot and the rendered note. Guard direct browser creation as well as MCP. Where authorship immutability is uncertain in Jazz, make private browser writes use the same authorized server command as MCP and use Jazz subscriptions for live reads.

**Tests:** simultaneous redemption yields at most one grant; replay, expiry, revoked invite and non-owner issuance fail. Two users can share a display name while keeping different IDs. Editor writes show the right author in both open browsers, viewer cannot write, and an edit cannot change authorship. Stop here for the browser-only demo only if private Jazz tests pass.

## 5. Protect MCP and bind every call to an approved user and board · 6–10 hours

**PR 4.** Keep `/patchboard-mcp` bound exclusively to disposable guest data. Mount a separate private handler before static fallback and verify credentials before invoking tools. Start with local SDK integration tests; then publish narrowly scoped Funnel paths. Proposed routes below are implementation targets on `https://tests-macbook-air.tail70b8a.ts.net`.

| Purpose | Proposed path and expected behavior |
|---|---|
| Private Foldkit, invites and Jazz | `/patchboard-private/`, `/patchboard-private/invite`, `/patchboard-private/jazz/…`; private Jazz upgrade and sync are authenticated |
| OAuth issuer and provider | `/patchboard-auth`; mount the provider's actual sign-in, authorize, token, revocation and JWKS endpoints beneath it; publish their exact URLs in discovery |
| MCP resource and audience | `/patchboard-mcp-auth`; missing/invalid bearer yields 401 and a Bearer challenge with resource_metadata |
| Protected-resource metadata | `/.well-known/oauth-protected-resource/patchboard-mcp-auth`; resource exactly matches the HTTPS MCP URI and points to the issuer |
| Authorization-server discovery | `/.well-known/oauth-authorization-server/patchboard-auth`; return exact issuer and provider endpoints, S256 capability and supported scopes |

Use a fixed origin for generated metadata. Verify actual paths requested by ChatGPT from redacted logs. Forward only required scoped paths after checking existing Funnel handlers, including 443 root, /orbit-mcp, 10000 and 8443. Same-origin paths share a browser trust boundary. Confirm the other apps on this origin are trusted for private sign-in before putting real accounts there; otherwise isolate the private origin on the same MacBook and repeat RP/origin registration. Delay private publication if discovery collides with an existing handler.

Adapt `createMcpProtectedRequestHandler` from RemoteMCP-Jazz with a small SDK 1.x adapter. Use provider-managed authorization-code + S256, state, exact redirect URI from each connector's management page, resource on authorization and token exchange, explicit consent, short-lived access tokens, refresh rotation and revocation. Prefer the reference's validated CIMD path, with a supported pre-registered client or DCR only if needed. Copy its constrained metadata fetch rules. Verify signature/allowed algorithm, issuer, audience, expiry and scopes per request. Use provider grant status or introspection when immediate revocation is required; checking a JWT signature alone leaves issued tokens usable until expiry. Test logout and grant revocation separately.

**Suggested application boundary** (TypeScript pseudocode; helper names describe contracts to implement):

```ts
const claims = await verifyAccessToken(request, { issuer, audience: mcpUrl });
const userId = await accounts.requireUser(claims.iss, claims.sub);
const boardId = await grants.requireApprovedBoard(claims, userId);
const input = createNoteArgs.strict().parse(toolArguments);
await requireToolScope(claims, "create_note");
return writeAuthorizedNote({ userId, boardId }, input);
```

Inside the serializable domain operation, recheck current membership with the same transaction used for receipt lookup and insertion, **including replay and retry branches**. Set authorId from the principal. Keep the public tool contract restricted to text and request_id. Apply the equivalent read permission and scope to read_board. Explicitly reject unsupported actor/board fields on both tools. Viewers receive a permission error even with a valid user token. Only return success after durable Jazz acceptance.

Reuse the uncommitted actor-scoped receipt change. Keep legacy v1 IDs for historical guest retries. Require a nonoptional verified actor on the private entry point and use (board, actor, request ID) for new receipt IDs. Preserve conflict-on-different-text, concurrency and exact-ID recovery. Test the same request ID from two verified subjects through the private handler; a unit test passing actorId directly does not exercise OAuth.

## 6. Run the release rehearsal · 5–9 hours

**PR 5, depends on all previous gates.** Add reproducible private startup and acceptance scripts and keep external rehearsals separate from offline CI. Exercise this minimum matrix:

| Actor or condition | Required observation |
|---|---|
| A owner, B invited editor | Two independent passkeys, two distinct OAuth grants, each account consents to the same board |
| C outsider, viewer V | C receives no board rows, snapshots or live notes over Jazz or MCP; V reads but cannot write through either path |
| Missing, expired, revoked, wrong-audience or wrong-issuer token | Private MCP rejects before tool execution; a valid token lacking scope cannot execute the action |
| Same request ID, same/different actors | Per actor retries return the original ID; actors receive distinct notes; changed payload conflicts |
| Board switch, reconnect, session expiry | No previous user's board survives UI/session handoff; no newly unauthorized data arrives |
| Controlled private-process restart | Both notes recover with original note IDs, authors, board, text and coordinates; old guest demo still responds |

Smoke commands after deployment (the metadata routes are proposed and should become executable acceptance assertions):

```sh
ORIGIN=https://tests-macbook-air.tail70b8a.ts.net
curl -fsS "$ORIGIN/.well-known/oauth-protected-resource/patchboard-mcp-auth"
curl -fsS "$ORIGIN/.well-known/oauth-authorization-server/patchboard-auth"
curl -si -X POST "$ORIGIN/patchboard-mcp-auth" -H 'Content-Type: application/json' -d '{}'
```

Confirm that last request returns the 401 challenge. From outside the tailnet, open the private board in two already-authenticated independent browsers. B connects from **B's own ChatGPT account** and creates a distinct marked note, then A does the same from A's own account. Record tool results, both browser updates without refresh, stable internal author IDs and note IDs. Restart only the private listener with both original DB paths. Re-open both pages and verify the same tuples. Capture redacted traces, commit, commands and pass/fail for each gate. Never attach tokens, cookies or reusable invite links.

## Working day and release decision

| Elapsed time today | Action and decision |
|---|---|
| Hours 0–1 | Confirm account access, claim the worktree, inspect baseline failure and record routes. Identify unavailable people immediately. |
| Hours 1–3 | Exercise passkey enrollment and Jazz identity adapter against pinned packages. Choose one identity mapping and freeze the public origin before enrolling users. |
| Hours 3–6 | Finish two real sessions; prioritize deny-by-default policy, outsider stream denial and viewer denial on a seeded board. |
| Hours 6–8 | If those pass, add the smallest owner invitation and attributed browser write. Otherwise continue private policy tests and retain the guest demo for tomorrow. |
| Remaining time before presentation | Attempt authenticated SDK then real ChatGPT only after their prerequisites pass. Reserve one hour for a repeat rehearsal and evidence review. |

**Go/no-go ladder:** (1) Full product demonstration only after A and B each make a real, attributed ChatGPT write and all denial/restart gates pass. (2) If ChatGPT access alone blocks release, show two independently authorized SDK clients and call it an OAuth SDK demonstration. (3) If MCP OAuth is unfinished, show the verified private browser workflow, naming any pre-seeded membership or outstanding invitation work. (4) If private authorization is unproven, show only the existing disposable guest demo. Defer Eidos, richer widgets, generalized admin, additional boards and proposal approval.

**Each PR:** one observable behavior per commit; keep red/green evidence, run the layer-specific test and full pnpm verify, include generated migrations and a short redacted recording. On the auth branch update the assignment pointers in AGENTS.md and docs/ROADMAP.md while retaining the guest release runbook.

### Reference shelf

- [RemoteMCP-Jazz passkey and OAuth assembly](https://github.com/drunkod/RemoteMCP-Jazz/blob/fae173e5d6e955a582bfeb29542e828a39b38812/control-plane/apps/control-plane/lib/auth-plugins.ts) · [Protected MCP handler](https://github.com/drunkod/RemoteMCP-Jazz/blob/fae173e5d6e955a582bfeb29542e828a39b38812/control-plane/apps/control-plane/app/api/mcp/route.ts)
- [Jamroom-Jazz invitation redemption](https://github.com/drunkod/jamroom-jazz/blob/3b68f99fd465783d4c1cf17864048de9c84ab977/app/api/join/route.ts) · [Permission tests](https://github.com/drunkod/jamroom-jazz/blob/3b68f99fd465783d4c1cf17864048de9c84ab977/tests/policies.test.ts)
- [OpenAI connector authentication](https://developers.openai.com/plugins/build/auth) · [Better Auth provider](https://better-auth.com/docs/plugins/oauth-provider) · [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
