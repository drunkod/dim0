import test from "node:test"
import assert from "node:assert/strict"
import { redeemJazzInvite, continueJazzSignIn } from "./jazz-invite-lifecycle.ts"

const invite = { boardId: "9c41c2db-f98d-4bb1-a175-722ad237d9e1", token: "test-invite-redacted" }
const success = () => Promise.resolve({ ok: true, status: 200 })
const failed = status => () => Promise.resolve({ ok: false, status })

test("no pending invite loads boards without making a join request", async () => {
  let loads = 0
  const outcome = await continueJazzSignIn(() => false, () => false, async () => { loads++ })
  assert.deepEqual(outcome, { status: "none" })
  assert.equal(loads, 1)
})

test("passkey login with pending link NEVER makes an automatic join", async () => {
  let loads = 0
  let pendingChecks = 0
  const outcome = await continueJazzSignIn(() => false, () => {
    pendingChecks++
    return true
  }, async () => { loads++ })
  assert.deepEqual(outcome, { status: "pending" })
  assert.equal(pendingChecks, 1)
  assert.equal(loads, 1)
  // No 'redeem' callback exists in continueJazzSignIn's interface.
  // Direct acceptance remains exclusively on the explicit invite landing.
})

test("explicit user acceptance consumes a valid invitation only once", async () => {
  let current = invite
  let calls = 0
  const join = async () => { calls++; return success() }
  // Nothing happens until the UI invokes redeemJazzInvite.
  assert.equal(calls, 0)
  const outcome = await redeemJazzInvite(current, join, expected => {
    if (current === expected) current = null
  })
  assert.deepEqual(outcome, { status: "joined", boardId: invite.boardId })
  assert.equal(calls, 1)
  assert.equal(current, null)
})

test("404 terminal invite is cleared only on explicit acceptance", async () => {
  let current = invite
  let cleared = false
  const outcome = await redeemJazzInvite(current, failed(404), expected => {
    if (current === expected) { current = null; cleared = true }
  })
  assert.deepEqual(outcome, {
    status: "invalid", message: "Invitation expired or revoked. Ask the owner for a fresh link.",
  })
  assert.equal(cleared, true)
  assert.equal(current, null)
})

test("temporarily unavailable invitation stays pending until explicit retry", async () => {
  let current = invite
  let calls = 0
  const first = await redeemJazzInvite(current, async () => {
    calls++
    return { ok: false, status: 503 }
  }, () => { current = null })
  assert.equal(first.status, "retryable")
  assert.equal(current, invite)
  const second = await redeemJazzInvite(current, async () => {
    calls++
    return success()
  }, () => { current = null })
  assert.deepEqual(second, { status: "joined", boardId: invite.boardId })
  assert.equal(calls, 2)
  assert.equal(current, null)
})

test("network failure keeps the invite instead of silently losing it", async () => {
  let cleared = false
  const result = await redeemJazzInvite(invite, async () => {
    throw new Error("offline")
  }, () => { cleared = true })
  assert.equal(result.status, "retryable")
  assert.equal(cleared, false)
})

test("ChatGPT OAuth consent has priority over an unrelated saved invitation", async () => {
  let pendingChecks = 0
  let loads = 0
  const outcome = await continueJazzSignIn(() => true, () => {
    pendingChecks++
    return true
  }, async () => { loads++ })
  assert.deepEqual(outcome, { status: "oauth" })
  assert.equal(pendingChecks, 0)
  assert.equal(loads, 0)
})
