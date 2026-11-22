/**
 * Literal Teable 67×5 action allow/deny is only ONE policy input. This
 * evaluator additionally demands current subject, resource and explicit
 * caller-supplied delegated/share/edition constraints. It does not upgrade
 * existing Dim0 "agent"/"admin" into Teable Creator/Owner.
 */
import { ROLE_ACTION_ROWS, type TeableAction, type TeableRole } from "./role-matrix.ts";
export type { TeableAction, TeableRole } from "./role-matrix.ts";
export function sourceActionAllowed(action: TeableAction, role: TeableRole): boolean {
  const row = ROLE_ACTION_ROWS[action];
  return row !== undefined && row[role] === "allow";
}
export type RoleSource = Readonly<{ role: TeableRole; active: true }>;
export interface CurrentPolicyInputs {
  readonly humanVerified: boolean;
  readonly resourceBelongsToWorkspace: boolean;
  readonly spaceRole: RoleSource | null;
  readonly baseRole: RoleSource | null;
  readonly delegatedActions: ReadonlySet<TeableAction>;
  readonly sharePermittedActions: ReadonlySet<TeableAction>;
  readonly serviceGuardAllowed: boolean;
}
export function canPerformTeableAction(
  action: TeableAction, input: CurrentPolicyInputs
): boolean {
  if (!input.humanVerified || !input.resourceBelongsToWorkspace ||
      !input.serviceGuardAllowed ||
      !input.delegatedActions.has(action) ||
      !input.sharePermittedActions.has(action)) return false;
  return Boolean(
    (input.spaceRole && sourceActionAllowed(action, input.spaceRole.role)) ||
    (input.baseRole && sourceActionAllowed(action, input.baseRole.role))
  );
}
