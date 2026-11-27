import assert from "node:assert/strict";
import test from "node:test";
import { dim0EntryLocation } from "../src/dim0-entry-location.ts";

const board = "12345678-1234-4567-89ab-123456789abc";
const token = "A".repeat(43);

test("old single-use invitation URLs reach the canonical Dim0 invitation screen", () => {
  for (const path of ["/patchboard-private", "/patchboard-private/", "/patchboard-private/index.html"]) {
    assert.equal(dim0EntryLocation(path + "?board=" + board + "&invite=" + token),
      "/share/join/" + board + "#invite=" + token);
  }
});

test("plain and OAuth entries retain their sign-in destination and query", () => {
  assert.equal(dim0EntryLocation("/patchboard-private/"), "/signin");
  const search = "?client_id=qa&state=abc%2Bdef&scope=board%3Aread";
  assert.equal(dim0EntryLocation("/patchboard-private/" + search), "/signin" + search);
});

test("incomplete or ambiguous invitations never fall through to ordinary sign-in", () => {
  for (const query of [
    "board=" + board,
    "invite=" + token,
    "board=bad&invite=" + token,
    "board=" + board + "&invite=short",
    "board=" + board + "&invite=" + token + "&invite=" + token,
    "board=" + board + "&board=" + board + "&invite=" + token,
    "board=" + board + "&invite=" + token + "&invite=bad",
  ]) {
    assert.equal(dim0EntryLocation("/patchboard-private/?" + query), null, query);
  }
});
