---
name: dim0-board
description: Operate a shared Dim0 infinite canvas through the board-scoped OAuth MCP tools. Use for reading cards, creating visible canvas nodes, version-checked renames, modifying applet source or shared state, and confirming collaborator attribution. Never infer identity from a ChatGPT name; use Jazz actors and authorized board grants.
---

# Dim0 collaborative board workflow

## Connect and choose the authorized board

Run `list_boards` first. Only the board explicitly approved during the
OAuth consent flow is accessible. If the expected board is absent, have the
account holder sign into **their own** Dim0 browser profile, redeem a board
invite, and reconnect/approve it. Do not try guessed board IDs or ask for
access tokens. Read `read_board` for board data and
`list_canvas_entities` for visible cards, links and applets.

## Create a canvas card

Use `create_canvas_entity` for a visible canvas node; **not** `create_note`,
which stores a different legacy note. Supply an actual new UUID as the
entity ID, the approved board UUID as `graphUid`, `kind: "node"`, and a
complete valid Dim0 payload (label, content, style and position/size
properties consistent with existing nodes). Inspect an existing node first
if you need a template. Preserve unique ID and board boundaries.

## Rename or edit a card without losing fields

1. Locate the target with `list_canvas_entities` and read its entire record
   with `get_canvas_entity`.
2. Copy the full `payload`, changing only the intended
   `label.markdown`/content or applet source field. Keep the same `id`,
   `graphUid` and all unrelated fields.
3. Call `update_canvas_entity` with the same board and entity IDs,
   the record's current `expected_version`, and the full updated payload.
4. If `VERSION_CONFLICT` occurs, **do not retry stale input blindly**.
   Re-read the current version, compare edits and ask which change to keep.

`updatedBy` is assigned by the server from the OAuth bearer subject's
Jazz account. Do not claim that a display name, ChatGPT identity or
text in the card proves the writer's identity.

## Shared applet runtime state

For persist-enabled applets, read the canonical JSON state with
`get_applet_state`. To change it, send the **exact**
`expected_version` and a JSON object to `update_applet_state`. The
state revision is **separate** from the canvas geometry/source revision.
A stale update is rejected instead of silently overwriting a second editor.
If the tool is missing from a previously installed connection, reconnect
and refresh the MCP tool list. Large/invalid state objects are rejected.

## Confirm a second editor

Each collaborator must independently sign in to Dim0 while connecting their
own ChatGPT account. The owner creates a card; the friend reads it, renames it
and records the returned version. Owner re-reads and checks the same card ID,
a higher version and the friend's different `updatedBy` Jazz actor. Verify
viewer access cannot write. If the friend's browser was already signed in as
the owner, the connection may legitimately act as the owner: reconnect
from their own browser profile/passkey before testing.
