import { consumeRegistrationIntent, resolveRegistrationIntent } from "./enrollment.ts";

/**
 * Resumable after-passkey verification step: a failed final DELETE must not
 * strand a Better Auth user who has already been durably created.
 */
export async function finalizeVerifiedPasskeyRegistration(
  ticket: string | null | undefined,
  verifiedUserId: string,
  userAlreadyExists: (id: string) => Promise<boolean>,
  createUser: (identity: { id: string; name: string }) => Promise<void>,
) {
  const identity = await resolveRegistrationIntent(ticket);
  if (identity.id !== verifiedUserId) {
    throw new Error("Registration ticket identity mismatch");
  }
  if (!await userAlreadyExists(identity.id)) await createUser(identity);
  await consumeRegistrationIntent(ticket, verifiedUserId);
  return { userId: identity.id, name: identity.name };
}
