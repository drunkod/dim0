/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-085 branch, NOT a mock success.
 * Requirement: Record old/new role, operator, resource, principal, time
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.updateCollaborator
 * Owner: Platform, PR 1; gated acc.audit.085=false-until-verified.
 * Tests: ACC-085-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AuditRoleChangeCommand = PlannedAccCommand<"ACC-085">;
export type AuditRoleChangeResult = PlannedAccResult<"ACC-085">;
export function runACC085(_input: AuditRoleChangeCommand): never {
  return notImplemented("ACC-085");
}
