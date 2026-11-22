/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-057 branch, NOT a mock success.
 * Requirement: Create project-level member with role and resource scoping
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.createBaseCollaborator
 * Owner: Collaboration, PR 8; gated acc.membership.057=false-until-verified.
 * Tests: ACC-057-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AddBaseMemberCommand = PlannedAccCommand<"ACC-057">;
export type AddBaseMemberResult = PlannedAccResult<"ACC-057">;
export function runACC057(_input: AddBaseMemberCommand): never {
  return notImplemented("ACC-057");
}
