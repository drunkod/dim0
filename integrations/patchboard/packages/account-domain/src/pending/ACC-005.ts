/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-005 branch, NOT a mock success.
 * Requirement: Risk checks before registration, invitation and account linking
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/risk-control/risk-control.service.ts::RiskControlService.isEmailDenied
 * Owner: Identity, PR 7; gated acc.registration.005=false-until-verified.
 * Tests: ACC-005-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RiskCheckEmailCommand = PlannedAccCommand<"ACC-005">;
export type RiskCheckEmailResult = PlannedAccResult<"ACC-005">;
export function runACC005(_input: RiskCheckEmailCommand): never {
  return notImplemented("ACC-005");
}
