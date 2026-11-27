import type { AuthSubjectId, BoardId, JazzActorId, VerifiedHuman, WorkspaceId } from "./contracts.ts";
/** Ports deliberately contain no SDK types; only server adapters implement them. */
export interface VerifiedIdentityPort {
  requireVerifiedHuman(): Promise<VerifiedHuman>;
  jazzActorForVerifiedSubject(id: AuthSubjectId): Promise<JazzActorId>;
  requireRecentPasskeyProof(id: AuthSubjectId): Promise<void>;
}
export interface ScopedMembershipPort {
  hasCurrentAction(actor: VerifiedHuman, board: BoardId, action: string): Promise<boolean>;
  currentOwnerSet(workspace: WorkspaceId): Promise<{
    eligibleOwners: readonly AuthSubjectId[];
    revision: number;
  }>;
}
export interface PrivateGrantAdmissionPort {
  admitIfLive(input: {
    readonly verifiedSubject: AuthSubjectId;
    readonly clientId: string;
    readonly grantId: string;
    readonly board: BoardId;
    readonly requiredScope: "board:read" | "board:write";
    readonly payloadHash: string;
    readonly requestId: string;
  }): Promise<{
    readonly admissionId: string;
    readonly grantVersion: number;
    readonly expiresAtEpochMs: number;
  }>;
}
export interface IdempotentOutboxPort {
  appendOnce(input: {
    readonly subject: AuthSubjectId;
    readonly aggregate: string;
    readonly aggregateVersion: number;
    readonly type: string;
    readonly sanitizedPayload: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
}
