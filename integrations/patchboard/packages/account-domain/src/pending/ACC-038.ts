/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-038 branch, NOT a mock success.
 * Requirement: Upload and validate user avatar
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.controller.ts::UserController.updateAvatar
 * Owner: Experience, PR 7; gated acc.profile.038=false-until-verified.
 * Tests: ACC-038-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type UpdateAvatarCommand = PlannedAccCommand<"ACC-038">;
export type UpdateAvatarResult = PlannedAccResult<"ACC-038">;
export function runACC038(_input: UpdateAvatarCommand): never {
  return notImplemented("ACC-038");
}
