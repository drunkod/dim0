import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  installJazzMemberDirectory, rememberJazzMemberIdentity, tryRememberJazzMemberIdentity, memberDisplayNames,
} from "../src/private-auth/member-directory.ts";

test("name lookup only resolves mapped Jazz grants and does not expose auth emails", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT)");
    installJazzMemberDirectory(db);
    installJazzMemberDirectory(db); // upgrade is idempotent
    db.prepare("INSERT INTO user (id,name,email) VALUES (?,?,?)").run(
      "better-auth-a", "Friend A", "private@example.test");
    db.prepare("INSERT INTO user (id,name,email) VALUES (?,?,?)").run(
      "better-auth-b", "Friend B", "other@example.test");
    rememberJazzMemberIdentity(db, "account-a", "better-auth-a");
    rememberJazzMemberIdentity(db, "account-b", "better-auth-b");
    const scoped = memberDisplayNames(db, ["account-b", "unmapped-account", "account-b"]);
    assert.deepEqual([...scoped], [["account-b", "Friend B"]]);
    assert.equal(JSON.stringify([...scoped]).includes("example.test"), false);
    assert.equal(memberDisplayNames(db, []).size, 0);
    assert.throws(() => memberDisplayNames(db, Array.from(
      { length: 202 }, (_, i) => "id-" + i)), /Too many board members/);
  } finally { db.close(); }
});

test("auth subject remapping never assigns one Jazz account to another subject", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
    installJazzMemberDirectory(db);
    db.prepare("INSERT INTO user (id,name) VALUES (?,?)").run("a", "Alice");
    db.prepare("INSERT INTO user (id,name) VALUES (?,?)").run("b", "Bob");
    rememberJazzMemberIdentity(db, "jazz-old", "a");
    rememberJazzMemberIdentity(db, "jazz-new", "a");
    assert.equal(memberDisplayNames(db, ["jazz-old"]).size, 0);
    assert.equal(memberDisplayNames(db, ["jazz-new"]).get("jazz-new"), "Alice");
    assert.throws(() => rememberJazzMemberIdentity(db, "jazz-new", "b"), /UNIQUE/);
    assert.equal(memberDisplayNames(db, ["jazz-new"]).get("jazz-new"), "Alice");
  } finally { db.close(); }
});

test("an optional display-name conflict cannot overwrite a mapped identity", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const warning = t.mock.method(console, "warn", () => {});
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
  installJazzMemberDirectory(db);
  const addUser = db.prepare("INSERT INTO user (id,name) VALUES (?,?)");
  addUser.run("auth-alice", "Alice");
  addUser.run("auth-bob", "Bob");
  rememberJazzMemberIdentity(db, "jazz-alice", "auth-alice");
  assert.doesNotThrow(() =>
    tryRememberJazzMemberIdentity(() => db, "jazz-alice", "auth-bob"));
  assert.equal(warning.mock.callCount(), 1);
  assert.deepEqual([...memberDisplayNames(db, ["jazz-alice"])], [["jazz-alice", "Alice"]]);
  tryRememberJazzMemberIdentity(() => db, "jazz-bob", "auth-bob");
  assert.equal(memberDisplayNames(db, ["jazz-bob"]).get("jazz-bob"), "Bob");
});

test("a database-open failure is contained and logged without sensitive identifiers", (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  assert.doesNotThrow(() =>
    tryRememberJazzMemberIdentity(() => { throw new Error("secret account detail"); },
      "private-jazz-id", "private-auth-id"));
  assert.equal(warning.mock.callCount(), 1);
  const args = JSON.stringify(warning.mock.calls[0].arguments);
  assert.doesNotMatch(args, /secret account detail|private-jazz-id|private-auth-id/);
});
