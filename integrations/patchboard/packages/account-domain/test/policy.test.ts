import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLE_ACTION_ROWS, type TeableAction } from "../src/role-matrix.ts";
import { canPerformTeableAction, sourceActionAllowed } from "../src/policy.ts";
const roles = ["owner", "creator", "editor", "commenter", "viewer"] as const;
describe("literal Teable source cells (NOT installed runtime permission proof)", () => {
  const actions = Object.keys(ROLE_ACTION_ROWS) as TeableAction[];
  it("has exactly 67 source actions", () => assert.equal(actions.length, 67));
  for (const action of actions) for (const role of roles) {
    it(action + " : " + role + " preserves source decision", () => {
      assert.equal(sourceActionAllowed(action, role),
        ROLE_ACTION_ROWS[action][role] === "allow");
    });
  }
  it("does not infer monotonic role ranking", () => {
    assert.equal(sourceActionAllowed("base|query_data", "viewer"), true);
    assert.equal(sourceActionAllowed("base|query_data", "commenter"), false);
  });
  it("role ancestry is union, delegated grant and share ceilings intersect", () => {
    const action: TeableAction = "base|query_data";
    const base = {
      humanVerified: true, resourceBelongsToWorkspace: true,
      spaceRole: {role:"viewer" as const, active:true as const},
      baseRole: null, delegatedActions: new Set([action]),
      sharePermittedActions: new Set([action]), serviceGuardAllowed:true
    };
    assert.equal(canPerformTeableAction(action, base), true);
    assert.equal(canPerformTeableAction(action, {...base, spaceRole:null}), false);
    assert.equal(canPerformTeableAction(action, {...base, delegatedActions:new Set<TeableAction>()}), false);
    assert.equal(canPerformTeableAction(action, {...base, sharePermittedActions:new Set<TeableAction>()}), false);
    assert.equal(canPerformTeableAction(action, {...base, humanVerified:false}), false);
    assert.equal(canPerformTeableAction(action, {...base, serviceGuardAllowed:false}), false);
    assert.equal(canPerformTeableAction(action, {...base, resourceBelongsToWorkspace:false}), false);
  });
  it("independent Space union may preserve action after base downgrade", () => {
    const action: TeableAction = "base|query_data";
    const common = {
      humanVerified: true, resourceBelongsToWorkspace:true,
      baseRole: {role:"commenter" as const, active:true as const},
      delegatedActions: new Set([action]), sharePermittedActions:new Set([action]),
      serviceGuardAllowed:true
    };
    assert.equal(canPerformTeableAction(action, {...common,spaceRole:null}), false);
    assert.equal(canPerformTeableAction(action,
      {...common,spaceRole:{role:"viewer",active:true} as const}), true);
  });
});
