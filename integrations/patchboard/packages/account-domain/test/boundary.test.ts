import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT_NEW_MCP_TOOLS, CAPABILITIES, accountFeatureEnabled } from "../src/registry.ts";
import { GAP_IDS, UNKNOWN_IDS } from "../src/ids.ts";
import { UNAVAILABLE_ACCOUNT_SCREENS } from "../src/ui-states.ts";
const root = join(dirname(fileURLToPath(import.meta.url)), "../src");
const files = (p: string): string[] => readdirSync(p, {withFileTypes:true}).flatMap(entry =>
  entry.isDirectory() ? files(join(p,entry.name)) :
  entry.name.endsWith(".ts") ? [join(p,entry.name)] : []);
describe("account domain import/exposure boundaries", () => {
  it("has no Better Auth, Jazz, HTTP, React, MCP or operational IO dependencies", () => {
    for (const f of files(root)) {
      const text = readFileSync(f,"utf8");
      // Deliberately avoid replacing this with a regex that searches comments.
      const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^\n]*?from\s+)?[\x22\x27]([^\x22\x27]+)[\x22\x27]/g)];
      for (const match of imports) {
        const target=match[1]!;
        assert.ok(target.startsWith("."),
          f + " must not depend on external auth/network/database: " + target);
      }
    }
  });
  it("keeps all new account tools absent from MCP discovery", () => {
    assert.deepEqual(ACCOUNT_NEW_MCP_TOOLS, []);
    assert.equal(GAP_IDS.length,84);
    assert.equal(UNKNOWN_IDS.length,8);
    for (const id of [...GAP_IDS,...UNKNOWN_IDS]) assert.equal(accountFeatureEnabled(id),false);
  });
  it("has 92 disabled structural screens and no email-delivered success text", () => {
    assert.equal(UNAVAILABLE_ACCOUNT_SCREENS.length,92);
    assert.equal(CAPABILITIES.length,93);
    assert.ok(UNAVAILABLE_ACCOUNT_SCREENS.every(x => !x.available && x.actionDisabled && !x.emailSent));
  });
});
