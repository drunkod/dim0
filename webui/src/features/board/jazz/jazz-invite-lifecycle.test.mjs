import test from "node:test"
import assert from "node:assert/strict"
import { redeemJazzInvite, continueJazzSignIn } from "./jazz-invite-lifecycle.ts"

const invite = { boardId: "9c41c2db-f98d-4bb1-a175-722ad237d9e1", token: "test-invite-redacted" }
const success = () => Promise.resolve({ ok: true, status: 200 })
const failed = (status) => () => Promise.resolve({ ok: false, status })

test("no pending invite loads boards without making a join request", async () => {
  let joins = 0
  let loads = 0
  const outcome = await continueJazzSignIn(() => false, () => redeemJazzInvite(null,
    () => { joins++; return success() }, () => {}), async () => { loads++ })
  assert.deepEqual(outcome, { status: "none" })
  assert.equal(joins, 0)
  assert.equal(loads, 1)
})

test("404 deletes the old invitation and still loads the verified user's dashboard", async () => {
  let current = invite
  let loads = 0
  const outcome = await continueJazzSignIn(() => false,
    () => redeemJazzInvite(current, failed(404), (expected) => {
      if (current === expected) current = null
    }), async () => { loads++ })
  assert.deepEqual(outcome, {
    status: "invalid", message: "Invitation expired or revoked. Ask the owner for a fresh link.",
  })
  assert.equal(current, null)
  assert.equal(loads, 1)
})

test("temporary 503 keeps invitation for retry; retry joins and skips board list", async () => {
  let current = invite
  let loads = 0
  const first = await continueJazzSignIn(() => false,
    () => redeemJazzInvite(current, failed(503), () => { current = null }),
    async () => { loads++ })
  assert.equal(first.status, "retryable")
  assert.equal(current, invite)
  assert.equal(loads, 1)
  const second = await continueJazzSignIn(() => false,
    () => redeemJazzInvite(current, success, () => { current = null }),
    async () => { loads++ })
  assert.deepEqual(second, { status: "joined", boardId: invite.boardId })
  assert.equal(current, null)
  assert.equal(loads, 1)
})

test("network failure retains the invite instead of silently losing it", async () => {
  let cleared = false
  const result = await redeemJazzInvite(invite, async () => {
    throw new Error("offline")
  }, () => { cleared = true })
  assert.equal(result.status, "retryable")
  assert.equal(cleared, false)
})

test("explicit ChatGPT OAuth consent wins over an unrelated saved invite", async () => {
  let joined = 0
  let loads = 0
  const result = await continueJazzSignIn(() => true, async () => {
    joined++
    return { status: "invalid", message: "Should not run" }
  }, async () => { loads++ })
  assert.deepEqual(result, { status: "oauth" })
  assert.equal(joined, 0)
  assert.equal(loads, 0)
})
