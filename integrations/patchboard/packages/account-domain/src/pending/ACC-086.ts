/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-086 branch, NOT a mock success.
 * Requirement: Record invitation issuance, acceptance/revocation, actor and limits
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.emailInvitation
 * Owner: Platform, PR 1; gated acc.audit.086=false-until-verified.
 * Tests: ACC-086-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AuditInvitationCommand = PlannedAccCommand<"ACC-086">;
export type AuditInvitationResult = PlannedAccResult<"ACC-086">;
export function runACC086(_input: AuditInvitationCommand): never {
  return notImplemented("ACC-086");
}
