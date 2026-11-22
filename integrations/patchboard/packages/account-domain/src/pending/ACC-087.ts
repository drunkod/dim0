/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-087 branch, NOT a mock success.
 * Requirement: Document PII erasure, affected spaces and revocation
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/delete-user/delete-user.service.ts::DeleteUserService.deleteUser
 * Owner: Platform, PR 1; gated acc.audit.087=false-until-verified.
 * Tests: ACC-087-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AuditAccountDeletionCommand = PlannedAccCommand<"ACC-087">;
export type AuditAccountDeletionResult = PlannedAccResult<"ACC-087">;
export function runACC087(_input: AuditAccountDeletionCommand): never {
  return notImplemented("ACC-087");
}
