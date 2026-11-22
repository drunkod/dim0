#!/usr/bin/env python3
"""Generate checked-in fail-closed ACC contracts and tests from frozen evidence.
PR0 source metadata is pinned. This generator NEVER touches live auth/Jazz state.
"""
import json,pathlib,re,sys
R=pathlib.Path(__file__).resolve().parents[1]
src=json.loads((R/'source-capabilities.json').read_text())
assert len(src)==93
ids=[f'ACC-{n:03d}' for n in range(1,94)]
assert [x['id'] for x in src]==ids
gaps=[x for x in src if x['classification'] in ('PARTIAL','MISSING')]
unknown=[x for x in src if x['classification']=='UNKNOWN']
assert len(gaps)==84 and len(unknown)==8
assert [x['id'] for x in src if x['classification']=='EXISTS']==['ACC-033']
assert all(re.fullmatch(r'[A-Z][A-Za-z0-9]*',x['inputDto']) and
 re.fullmatch(r'[A-Z][A-Za-z0-9]*',x['resultDto']) for x in src)
files={}
j=lambda v:json.dumps(v,ensure_ascii=False,indent=2)
files['src/ids.ts']='''// GENERATED SOURCE INVENTORY; original Teable ACC meanings retained.
export const ACC_IDS = '''+j(ids)+''' as const;
export type AccId = (typeof ACC_IDS)[number];
export const GAP_IDS = '''+j([x['id'] for x in gaps])+''' as const;
export type GapId = (typeof GAP_IDS)[number];
export const UNKNOWN_IDS = '''+j([x['id'] for x in unknown])+''' as const;
export type UnknownAccId = (typeof UNKNOWN_IDS)[number];
'''
fields=['id','area','requirement','classification','owner','pr','sourceSha','sourcePath',
 'sourceSymbol','sourceCallsiteStatus','sourceTestEvidence','existingTarget','proposedCommand',
 'inputDto','resultDto','featureFlag','mvpDisposition','nativeAlternative','mockup','testId']
files['src/registry.ts']='''// GENERATED registry. Source classification != enabled runtime capability.
import type { AccId, GapId, UnknownAccId } from "./ids.ts";
export interface AccCapability {
  readonly id: AccId;
  readonly area: string;
  readonly requirement: string;
  readonly classification: "EXISTS" | "PARTIAL" | "MISSING" | "UNKNOWN";
  readonly owner: string;
  readonly pr: string;
  readonly sourceSha: string;
  readonly sourcePath: string;
  readonly sourceSymbol: string;
  readonly sourceCallsiteStatus: string;
  readonly sourceTestEvidence: string;
  readonly existingTarget: string;
  readonly proposedCommand: string;
  readonly inputDto: string;
  readonly resultDto: string;
  readonly featureFlag: string;
  readonly mvpDisposition: string;
  readonly nativeAlternative: string;
  readonly mockup: string;
  readonly testId: string;
}
export const CAPABILITIES: readonly AccCapability[] = '''+j([{k:x[k] for k in fields} for x in src])+''' as const;
export const CAPABILITY_BY_ID: ReadonlyMap<AccId, AccCapability> =
  new Map(CAPABILITIES.map(row => [row.id, row]));
export function capabilityById(id: AccId): AccCapability {
  const row = CAPABILITY_BY_ID.get(id);
  if (!row) throw new Error("UNREGISTERED_ACC_ID");
  return row;
}
// These 84 branch stubs and 8 unknowns do NOT become MCP tools or a URL.
export const ACCOUNT_NEW_MCP_TOOLS: readonly string[] = Object.freeze([]);
export const ACCOUNT_DISABLED_UI_ROUTES: readonly string[] = Object.freeze(
  CAPABILITIES.filter(r => r.classification !== "EXISTS").map(r => r.mockup).filter(Boolean)
);
export const DISABLED_ACCOUNT_FLAGS: ReadonlyMap<AccId, false> =
  new Map(CAPABILITIES.map(row => [row.id, false] as const));
export function accountFeatureEnabled(_id: GapId | UnknownAccId): false {
  return false; // no environment override until implementation and QA approval
}
'''
imports=[];lookup=[]
for row in gaps:
 id=row['id'];fn='run'+id.replace('-','')
 f='src/pending/'+id+'.ts'
 files[f]=f'''/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable {id} branch, NOT a mock success.
 * Requirement: {row['requirement'].replace('*/','').replace(chr(10),' ')[:210]}
 * Pinned source: {row['sourceSha']} {row['sourcePath']}::{row['sourceSymbol']}
 * Owner: {row['owner']}, {row['pr']}; gated {row['featureFlag']}.
 * Tests: {id}-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import {{ notImplemented, type PlannedAccCommand, type PlannedAccResult }} from "../contracts.ts";
export type {row['inputDto']} = PlannedAccCommand<"{id}">;
export type {row['resultDto']} = PlannedAccResult<"{id}">;
export function {fn}(_input: {row['inputDto']}): never {{
  return notImplemented("{id}");
}}
'''
 imports.append(f'import {{ {fn} }} from "./{id}.ts";')
 lookup.append(f'  "{id}": {fn},')
files['src/pending/index.ts']='''// GENERATED static dispatch for unsupported ACC source branches ONLY.
import { notImplemented, type PlannedAccCommand } from "../contracts.ts";
import type { GapId } from "../ids.ts";
'''+ '\n'.join(imports)+'''
export const GAP_STUBS: Readonly<Record<GapId, (input: never) => never>> = {
'''+ '\n'.join(lookup)+'''
};
export function invokePending(id: GapId, input: PlannedAccCommand<GapId>): never {
  const fn = GAP_STUBS[id];
  if (!fn) return notImplemented(id);
  return fn(input as never);
}
'''
files['test/acc-source-fixtures.test.ts']='''// GENERATED runtime assertions for all 84 missing/partial ACC source branches.
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
'''
files['src/ui-states.ts']='''// Structural disabled UI semantics, NOT registered app routes.
import type { AccId } from "./ids.ts";
import { CAPABILITIES } from "./registry.ts";
export type UnavailableAccountScreen = Readonly<{
  accId: AccId; mockupReference: string; available: false;
  actionDisabled: true; emailSent: false;
}>;
export const UNAVAILABLE_ACCOUNT_SCREENS: readonly UnavailableAccountScreen[] =
  CAPABILITIES.filter(row => row.classification !== "EXISTS").map(row => ({
    accId: row.id, mockupReference: row.mockup,
    available: false, actionDisabled: true, emailSent: false,
  }));
'''
check='--check' in sys.argv;drift=[]
for name,src in files.items():
 p=R/name
 if check:
  if not p.is_file() or p.read_text()!=src:drift.append(name)
 else:
  p.parent.mkdir(parents=True,exist_ok=True);p.write_text(src)
if drift:
 print('GENERATED_REGISTRY_DRIFT',drift);sys.exit(1)
print(('VERIFIED' if check else 'GENERATED'),len(files),'files;',len(gaps),'disabled modules;',len(ids),'records')
