/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-017 branch, NOT a mock success.
 * Requirement: Use safe configurable password KDF and salt handling
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::Password.encodePassword
 * Owner: Identity, PR 7; gated acc.credentials.017=false-until-verified.
 * Tests: ACC-017-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type HashPasswordCommand = PlannedAccCommand<"ACC-017">;
export type HashPasswordResult = PlannedAccResult<"ACC-017">;
export function runACC017(_input: HashPasswordCommand): never {
  return notImplemented("ACC-017");
}
