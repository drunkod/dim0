import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const origin = process.env.PATCHBOARD_PRIVATE_ORIGIN ?? "http://localhost:8792";
const evidenceDir = process.env.PRIVATE_EVIDENCE_DIR ??
  "/Users/test/work/patchwork/demo/patchboard-private-nov21/evidence";
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const actors = [];
const pageErrors = [];
const wsHandshakes = [];

async function authActor(label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => pageErrors.push({ label, message: String(e) }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  }});
  const wsUrls = new Map();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", e => wsUrls.set(e.requestId, e.url));
  cdp.on("Network.webSocketHandshakeResponseReceived", e => {
    wsHandshakes.push({ label, status: e.response.status, url: wsUrls.get(e.requestId) });
  });
  await page.goto(origin + "/patchboard-private/");
  await expect(page.getByRole("heading", { name: "Sign in to your private board" }))
    .toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ }))
    .toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Jazz shared · connected")).toBeVisible({ timeout: 15000 });
  const accountResponse = await context.request.get(origin + "/patchboard-private/api/me");
  assert.equal(accountResponse.status(), 200);
  const identity = await accountResponse.json();
  assert.ok(identity.signedIn && identity.id && identity.accountId && identity.name);
  const actor = { label, context, page, ...identity };
  actors.push(actor);
  console.log("PRIVATE_PASSKEY_AUTHENTICATED", label, identity.id, identity.accountId);
  return actor;
}

async function post(actor, path, body) {
  return actor.page.evaluate(async ({ path, body }) => {
    const res = await fetch("/patchboard-private/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }, { path, body });
}

try {
  const A = await authActor("A");
  const B = await authActor("B");
  const C = await authActor("C");
  const V = await authActor("V");
  assert.equal(new Set([A.id, B.id, C.id, V.id]).size, 4);
  assert.equal(new Set([A.accountId, B.accountId, C.accountId, V.accountId]).size, 4);

  const title = "Private collaboration " + randomUUID().slice(0, 8);
  await A.page.getByPlaceholder("New board title").fill(title);
  await A.page.getByPlaceholder("New board title").press("Enter");
  await expect(A.page.getByRole("heading", { name: title })).toBeVisible({ timeout: 12000 });
  const boardId = new URL(A.page.url()).searchParams.get("board");
  assert.match(boardId, /^[0-9a-f-]{36}$/i);
  console.log("PRIVATE_BOARD_CREATED", boardId);

  // Entire editor invitation is exercised through real Foldkit UI; GET itself
  // must not consume the invite. Only the signed-in explicit accept POST does.
  await A.page.getByRole("button", { name: "Invite an editor" }).click();
  const inviteText = await A.page.getByText("Invitation link (copy and share):").textContent();
  const editorUrl = inviteText?.replace("Invitation link (copy and share): ", "").trim();
  assert.ok(editorUrl?.startsWith(origin + "/patchboard-private/"));
  const url = new URL(editorUrl);
  const token = url.searchParams.get("invite");
  assert.ok(token?.length === 43);
  await B.page.goto(editorUrl);
  await expect(B.page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
  await B.page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(B.page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => new URL(B.page.url()).searchParams.get("invite")).toBeNull();
  const replay = await post(B, "join", { board_id: boardId, token });
  assert.equal(replay.status, 404);
  const illegalReuse = await post(C, "join", { board_id: boardId, token });
  assert.equal(illegalReuse.status, 404);
  console.log("UI_INVITE_ACCEPTED_AND_REPLAY_DENIED");

  const viewerInvite = await post(A, "invite", { board_id: boardId, role: "viewer" });
  assert.equal(viewerInvite.status, 201);
  const viewerToken = new URL(viewerInvite.body.invite_url).searchParams.get("invite");
  assert.equal((await post(V, "join", { board_id: boardId, token: viewerToken })).status, 200);
  await V.page.goto(origin + "/patchboard-private/?board=" + boardId);
  await expect(V.page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15000 });
  assert.equal((await post(V, "note", {
    board_id: boardId, text: "Viewer must not write",
    request_id: "viewer-" + randomUUID(),
  })).status, 403);
  console.log("VIEWER_READ_ALLOWED_WRITE_FORBIDDEN");

  await C.page.goto(origin + "/patchboard-private/?board=" + boardId);
  await expect(C.page.getByText("Jazz shared · connected")).toBeVisible({ timeout: 15000 });
  const forbidden = await C.context.request.get(origin + "/patchboard-private/api/board?board_id=" + boardId);
  assert.equal(forbidden.status(), 403);
  console.log("OUTSIDER_HTTP_DENIED");
  const outsiderForm = await post(C, "note", {
    board_id: boardId, text: "Forbidden outsider note",
    request_id: "outsider-" + randomUUID(),
  });
  assert.equal(outsiderForm.status, 403);

  const textB = "B's attributed note " + randomUUID().slice(0, 8);
  const textA = "A's attributed note " + randomUUID().slice(0, 8);
  await B.page.getByPlaceholder("Write a note…").fill(textB);
  await B.page.getByRole("button", { name: "Add note" }).click();
  await Promise.all([A, B].map(actor => expect(actor.page.locator(".note").filter({ hasText: textB }))
    .toBeVisible({ timeout: 20000 })));
  await A.page.getByPlaceholder("Write a note…").fill(textA);
  await A.page.getByRole("button", { name: "Add note" }).click();
  await Promise.all([A, B].map(actor => expect(actor.page.locator(".note").filter({ hasText: textA }))
    .toBeVisible({ timeout: 20000 })));
  await Promise.all([A, B].flatMap(actor => [
    expect(actor.page.locator(".note").filter({ hasText: textA }).getByText("Author: " + A.name)).toBeVisible(),
    expect(actor.page.locator(".note").filter({ hasText: textB }).getByText("Author: " + B.name)).toBeVisible(),
  ]));
  await expect(C.page.locator(".note")).toHaveCount(0, { timeout: 7000 });
  for (const marker of [textA, textB]) {
    await expect(V.page.locator(".note").filter({ hasText: marker }))
      .toBeVisible({ timeout: 12000 });
  }
  const readV = await V.context.request.get(origin + "/patchboard-private/api/board?board_id=" + boardId);
  assert.equal(readV.status(), 200);
  const readA = await A.context.request.get(origin + "/patchboard-private/api/board?board_id=" + boardId);
  assert.equal(readA.status(), 200);
  const saved = await readA.json();
  const noteA = saved.notes.find(n => n.text === textA);
  const noteB = saved.notes.find(n => n.text === textB);
  assert.equal(noteA.author_id, A.accountId);
  assert.equal(noteB.author_id, B.accountId);
  assert.notEqual(noteA.id, noteB.id);

  // Controlled restart of *only* this isolated local private service. The
  // guest demo on 8791 and all Funnel mappings remain untouched.
  const currentPid = Number(execFileSync("lsof", [
    "-nP", "-t", "-iTCP:8792", "-sTCP:LISTEN",
  ], { encoding: "utf8" }).trim());
  const command = execFileSync("ps", ["-p", String(currentPid), "-o", "command="], {
    encoding: "utf8",
  });
  assert.match(command, /private-demo\.ts/);
  process.kill(currentPid, "SIGTERM");
  let stopped = false;
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      execFileSync("lsof", ["-nP", "-t", "-iTCP:8792", "-sTCP:LISTEN"], {
        stdio: "ignore",
      });
    } catch {
      stopped = true;
      break;
    }
  }
  assert.ok(stopped, "Private server did not release port 8792");

  const root = resolve(process.cwd(), "../..");
  const fd = openSync(evidenceDir + "/private-restart.log", "a");
  const child = spawn("pnpm", ["--filter", "@patchboard/server", "exec", "tsx", "src/private-demo.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PATCHBOARD_PRIVATE_ROOT: "/Users/test/work/patchwork/demo/patchboard-private-nov21",
      PATCHBOARD_PRIVATE_ORIGIN: origin,
      PATCHBOARD_PRIVATE_PORT: "8792",
      PATCHBOARD_PRIVATE_DEV: "1",
    },
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);
  let restarted = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(700) });
      if (response.ok) { restarted = true; break; }
    } catch { /* service is still booting */ }
  }
  assert.ok(restarted, "Private server did not recover after restart");
  await Promise.all([A, B, V, C].map(actor => actor.page.reload()));
  await Promise.all([A, B, V].flatMap(actor => [
    expect(actor.page.locator(".note").filter({ hasText: textA })).toBeVisible({ timeout: 15000 }),
    expect(actor.page.locator(".note").filter({ hasText: textB })).toBeVisible({ timeout: 15000 }),
  ]));
  await expect(C.page.locator(".note")).toHaveCount(0, { timeout: 5000 });
  const restoredResponse = await A.context.request.get(
    origin + "/patchboard-private/api/board?board_id=" + boardId,
  );
  assert.equal(restoredResponse.status(), 200);
  const restored = await restoredResponse.json();
  for (const original of [noteA, noteB]) {
    const replayed = restored.notes.find(n => n.id === original.id);
    assert.deepEqual(replayed, original, "Note, author and position changed on restart");
  }
  console.log("PRIVATE_RESTART_EXACT_ID_AND_AUTHOR_PASS", JSON.stringify({
    boardId, noteIds: [noteA.id, noteB.id], authorIds: [noteA.author_id, noteB.author_id],
  }));

  for (const actor of [A, B, C, V]) {
    await actor.page.screenshot({ path: evidenceDir + "/private-collaboration-" + actor.label + ".png" });
  }
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  assert.ok([A, B].every(actor => wsHandshakes.some(w => w.label === actor.label && w.status === 101 && w.url?.includes("/patchboard-private/jazz/"))), JSON.stringify(wsHandshakes));
  const evidence = {
    result: "PASS",
    boardId, title, testAt: new Date().toISOString(),
    notes: [{ id: noteA.id, text: textA, authorId: noteA.author_id },
            { id: noteB.id, text: textB, authorId: noteB.author_id }],
    accounts: actors.map(({ label, id, accountId }) => ({ label, id, accountId })),
    outsiderDenied: true, viewerWriteDenied: true, inviteSingleUse: true,
    profiles: 4, restarted: true, pageErrors, wsHandshakes,
  };
  await writeFile(evidenceDir + "/private-collaboration-proof.json",
    JSON.stringify(evidence, null, 2) + "\n");
  console.log("PRIVATE_TWO_PERSON_BROWSER_PASS", JSON.stringify(evidence));
} finally {
  await Promise.all(actors.map(actor => actor.context.close()));
  await browser.close();
}
