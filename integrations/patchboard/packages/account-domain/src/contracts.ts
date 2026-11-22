/**
 * Account-domain only: no Better Auth, Jazz, Hono, React or MCP imports.
 * Verified principals must be constructed by the server auth adapter, not
 * marshalled from browser request JSON.
 */
import type { AccId } from "./ids.ts";
export type AuthSubjectId = string & { readonly __subject: unique symbol };
export type JazzActorId = string & { readonly __jazzActor: unique symbol };
export type WorkspaceId = string & { readonly __workspace: unique symbol };
export type BoardId = string & { readonly __board: unique symbol };
export type OpaqueId = string & { readonly __opaque: unique symbol };
export interface VerifiedHuman {
  readonly subjectId: AuthSubjectId;
  readonly jazzActorId: JazzActorId;
  readonly sessionVerified: true;
}
export type InvitationTarget =
  | Readonly<{ kind: "bearer_link" }>
  | Readonly<{ kind: "auth_subject"; subjectId: AuthSubjectId }>
  | Readonly<{ kind: "verified_email"; privateRecipientRef: OpaqueId }>;
export interface AcceptBearerLink {
  readonly boardId: BoardId;
  readonly token: string;
  readonly explicitAcceptance: true;
  readonly expectedRevision: number;
  readonly requestId: string;
}
export type PendingErrorCode =
  | "CAPABILITY_NOT_IMPLEMENTED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "STALE_STATE"
  | "REQUEST_ID_CONFLICT"
  | "INVITE_INVALID"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "SEAT_LIMIT_REACHED"
  | "RECOVERY_UNAVAILABLE"
  | "BLOCKED_SETTLEMENT";
export class CapabilityNotImplementedError extends Error {
  readonly code: "CAPABILITY_NOT_IMPLEMENTED" = "CAPABILITY_NOT_IMPLEMENTED";
  constructor(readonly accId: AccId) {
    super("CAPABILITY_NOT_IMPLEMENTED: " + accId);
    this.name = "CapabilityNotImplementedError";
  }
}
/**
 * Provisional operation-boundary DTO; each unsupported Teable source branch
 * MUST receive source-verified exact input fields before enabling.
 * This placeholder accepts no success code path, so unchecked arguments
 * cannot be used to mutate state in the meantime.
 */
export type PlannedAccCommand<Id extends AccId> = Readonly<{
  capability: Id;
  requestId: string;
  expectedVersion?: number;
  arguments: Readonly<Record<string, unknown>>;
}>;
export type PlannedAccResult<Id extends AccId> = Readonly<{
  capability: Id;
  receiptId: string;
  committedVersion: number;
}>;
export function notImplemented(id: AccId): never {
  throw new CapabilityNotImplementedError(id);
}
export type AccountCommandResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: Exclude<PendingErrorCode, "CAPABILITY_NOT_IMPLEMENTED"> }>;
