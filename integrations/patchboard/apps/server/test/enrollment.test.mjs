import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "patchboard-enrollment-sqlite-"));
process.env.PATCHBOARD_PRIVATE_ROOT = root;
process.env.PATCHBOARD_PRIVATE_ORIGIN = "http://localhost:8798";
process.env.PATCHBOARD_PRIVATE_DEV = "1";
process.env.PATCHBOARD_PRIVATE_REGISTRATION_CAP = "2";
const { newRegistrationIntent, resolveRegistrationIntent,
  consumeRegistrationIntent, EnrollmentLimitReached } =
  await import("../src/private-auth/enrollment.ts");
const { privateAuthDatabase, closePrivateAuthDatabase } =
  await import("../src/private-auth/db.ts");
const legacyDir = join(root, "auth", "enrollment-intents");
await mkdir(legacyDir, { recursive: true, mode: 0o700 });
const legacyValid = randomBytes(32).toString("base64url");
const legacyExpired = randomBytes(32).toString("base64url");
const hashed = ticket => createHash("sha256").update(ticket).digest("hex");
const legacyFile = ticket => join(legacyDir, hashed(ticket) + ".json");
const oldUserId = randomUUID();
await writeFile(legacyFile(legacyValid), JSON.stringify({
  userId: oldUserId, displayName: "Migrated", expiresAt: Date.now() + 280_000,
}));
await writeFile(legacyFile(legacyExpired), JSON.stringify({
  userId: randomUUID(), displayName: "Expired", expiresAt: Date.now() - 2000,
}));
const db = privateAuthDatabase();
const { finalizeVerifiedPasskeyRegistration } =
  await import("../src/private-auth/finalize-registration.ts");

test("expired intents are reclaimed; active tickets survive; concurrent cap is atomic", async () => {
  try {
    assert.equal((await resolveRegistrationIntent(legacyValid)).id, oldUserId);
    await assert.rejects(() => access(legacyFile(legacyValid)), /ENOENT/);
    await assert.rejects(() => access(legacyFile(legacyExpired)), /ENOENT/);
    // Legacy active intent is migratable and single-use; eliminate it before
    // testing the deliberately small new-issuance cap below.
    await consumeRegistrationIntent(legacyValid, oldUserId);
    const beginning = 200_000_000_000;
    const first = await newRegistrationIntent(beginning);
    const second = await newRegistrationIntent(beginning + 200_000);
    const resolvedSecond = await resolveRegistrationIntent(second, beginning + 210_000);
    await assert.rejects(() => newRegistrationIntent(beginning + 250_000), EnrollmentLimitReached);
    // Cleanup happens transactionally inside issuance, not only at redemption.
    const afterExpiry = await newRegistrationIntent(beginning + 300_001);
    assert.ok(afterExpiry);
    await assert.rejects(() => resolveRegistrationIntent(first, beginning + 300_001), /Expired/);
    assert.deepEqual(await resolveRegistrationIntent(second, beginning + 300_001), resolvedSecond);
    const pending = db.prepare("SELECT COUNT(*) AS amount FROM patchboard_enrollment_intent")
      .get();
    assert.equal(pending.amount, 2);
    await consumeRegistrationIntent(second, resolvedSecond.id, beginning + 300_001);
    const active = await newRegistrationIntent(beginning + 300_002);
    const identity = await resolveRegistrationIntent(active, beginning + 300_002);
    const outcomes = await Promise.allSettled([
      consumeRegistrationIntent(active, identity.id, beginning + 300_003),
      consumeRegistrationIntent(active, identity.id, beginning + 300_003),
    ]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected").length, 1);

    // Concurrent issuance of the final available slot: only one can win.
    db.prepare("DELETE FROM patchboard_enrollment_intent").run();
    const issued = await Promise.allSettled(Array.from({ length: 9 },
      () => newRegistrationIntent(beginning + 400_000)));
    assert.equal(issued.filter(item => item.status === "fulfilled").length, 2);
    assert.equal(issued.filter(item => item.status === "rejected").length, 7);
    for (const result of issued) if (result.status === "rejected") {
      assert.ok(result.reason instanceof EnrollmentLimitReached);
    }
    console.log("ENROLLMENT_SQLITE_CAP_EXPIRY_SINGLE_USE_PASS");

    // Simulate a provider adapter crash just after durable createUser, before
    // ticket finalization. Retrying with the verified same account recovers.
    db.prepare("DELETE FROM patchboard_enrollment_intent").run();
    const interrupted = await newRegistrationIntent(Date.now());
    const verified = await resolveRegistrationIntent(interrupted);
    let exists = false;
    await assert.rejects(() => finalizeVerifiedPasskeyRegistration(
      interrupted, verified.id,
      async () => exists,
      async () => { exists = true; throw new Error("after database insert crash"); },
    ), /after database insert crash/);
    assert.equal(exists, true);
    await finalizeVerifiedPasskeyRegistration(
      interrupted, verified.id,
      async () => exists,
      async () => { throw new Error("must not create duplicate user"); },
    );
    await assert.rejects(() => resolveRegistrationIntent(interrupted), /Expired/);
    console.log("ENROLLMENT_INTERRUPTED_REGISTRATION_RECOVERY_PASS");
  } finally {
    closePrivateAuthDatabase();
    await rm(root, { recursive: true, force: true });
  }
});
