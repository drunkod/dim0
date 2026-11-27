/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-062 branch, NOT a mock success.
 * Requirement: Never demote or remove only active space owner
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.isUniqueOwnerUser
 * Owner: Collaboration, PR 8; gated acc.membership.062=false-until-verified.
 * Tests: ACC-062-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ProtectLastOwnerCommand = PlannedAccCommand<"ACC-062">;
export type ProtectLastOwnerResult = PlannedAccResult<"ACC-062">;
export function runACC062(_input: ProtectLastOwnerCommand): never {
  return notImplemented("ACC-062");
}
