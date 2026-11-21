# Private Patchboard note edit/move authorization fix

**Reproduction (21 November 2026):** An invited editor on the disposable public staging board saw `Jazz update failed: authorization_denied: UPDATE policy (USING) denied the target row` when using the **Edit** or arrow buttons. The board remained connected and displayed both writers' notes. This was an application wiring bug, **not** a reason to broaden Jazz permissions.

## Root cause

`apps/web/src/main.ts` routed private `UpdateNote` and `MoveNote` commands through the client Jazz connection via `apps/web/src/board/jazz-effects.ts`. Private Jazz permissions deliberately deny **all direct browser inserts/updates/deletes**, including updates by owners and editors, and restrict private mutations to authenticated server commands. The creation button already followed the correct server pathway; editing and movement did not.

## Fix

- The private UI uses authenticated same-origin `POST /patchboard-private/api/note/update` and `POST /patchboard-private/api/note/move` for changes. Public guest mode retains the existing direct Jazz edit/move behavior.
- The server verifies the Better Auth session, derives the Jazz account ID from the server, and accepts only strict `note_id` + text or coordinates. It looks up the note's **stored** board ID and checks owner/editor/admin membership **inside the serializable transaction** before updating only the requested fields.
- The original note's `id`, `authorId`, `authorName`, and `boardId` cannot be changed by the requests. Viewer/outsider writes, cross-board writes and revoked-editor writes remain denied.
- Position coordinates are finite, nonnegative and no greater than 10000. Text is trimmed and limited to 2000 characters.
- **Private Jazz permissions are unchanged.** Public MCP authorization, OAuth issuer, and Funnel paths are unchanged.

## Verified tests

- `pnpm --filter @patchboard/server exec tsx --test test/private-authz.test.mjs`: server-authorized edit and move, viewer/outsider/cross-board and revoked-editor rejection, authorship unchanged, durable values after SQLite reopen.
- `pnpm test:private:ci`: isolated Better Auth SQLite, virtual passkeys and 3 profiles, OAuth PKCE/MCP, owner/editor live writes, browser edit of owner's note by editor, move by editor, viewer edit denied (403), Jazz subscriptions, restart and exact-ID/author retention.
- `pnpm verify`: see CI result on the PR.
- Before public staging promotion: back up dedicated staging root `/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging`, build the **private** UI, restart only port 8794, confirm read/write and reload with the existing browser account. Do not touch 8791, 8792 or Funnel mappings.

## Known separate items

Viewer controls are currently rendered even though server denies write actions. A role-aware disabled UI is a separate usability enhancement. Firefox virtual-passkey enrollment from the earlier cross-browser session remains independent of this fix.
