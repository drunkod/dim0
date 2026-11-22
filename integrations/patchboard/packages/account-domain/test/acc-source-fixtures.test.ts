// GENERATED runtime assertions for all 84 missing/partial ACC source branches.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACC_IDS, GAP_IDS, UNKNOWN_IDS } from "../src/ids.ts";
import { CAPABILITIES, ACCOUNT_NEW_MCP_TOOLS, DISABLED_ACCOUNT_FLAGS,
  accountFeatureEnabled } from "../src/registry.ts";
import { GAP_STUBS, invokePending } from "../src/pending/index.ts";
import { CapabilityNotImplementedError } from "../src/contracts.ts";
describe("Teable ACC source contracts and disabled branches", () => {
  it("keeps original 93 rows, 84 gap stubs and 8 unknown evidence gates", () => {
    assert.equal(ACC_IDS.length, 93);
    assert.equal(new Set(ACC_IDS).size, 93);
    assert.equal(GAP_IDS.length, 84);
    assert.equal(UNKNOWN_IDS.length, 8);
    for (const [name, n] of Object.entries({EXISTS:1, PARTIAL:42, MISSING:42, UNKNOWN:8})) {
      assert.equal(CAPABILITIES.filter(r => r.classification === name).length, n);
    }
    assert.deepEqual(ACCOUNT_NEW_MCP_TOOLS, []);
  });
  for (const id of GAP_IDS) {
    it(id + " is fail-closed with no dependency to write to", () => {
      const cmd = { capability: id, requestId: "same-request", arguments: Object.freeze({}) };
      for (const invoke of [() => GAP_STUBS[id](cmd as never),
                             () => invokePending(id, cmd)]) {
        assert.throws(invoke, (error) => {
          assert.ok(error instanceof CapabilityNotImplementedError);
          assert.equal(error.message, "CAPABILITY_NOT_IMPLEMENTED: " + id);
          assert.equal(error.accId, id);
          return true;
        });
      }
      assert.equal(DISABLED_ACCOUNT_FLAGS.get(id), false);
      assert.equal(accountFeatureEnabled(id), false);
    });
  }
  for (const id of UNKNOWN_IDS) {
    it(id + " is not advertised or enabled without evidence", () => {
      assert.equal(DISABLED_ACCOUNT_FLAGS.get(id), false);
      assert.equal(accountFeatureEnabled(id), false);
    });
  }
});
