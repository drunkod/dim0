import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

const client = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/patchboard-auth",
  plugins: [passkeyClient()],
});

export type PrivateIdentity = { id: string; name: string; accountId: string };

export async function session(): Promise<PrivateIdentity | null> {
  const response = await fetch("/patchboard-private/api/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to inspect the private session");
  const body = await response.json() as {
    signedIn?: boolean; id?: string; name?: string; accountId?: string;
  };
  if (!body.signedIn) return null;
  if (!body.id || !body.name || !body.accountId) throw new Error("Missing verified account identity");
  return { id: body.id, name: body.name, accountId: body.accountId };
}

export async function register(): Promise<PrivateIdentity> {
  const response = await fetch("/patchboard-private/api/registration-intent", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Cannot start passkey registration");
  const { context } = await response.json() as { context?: string };
  if (!context) throw new Error("Missing server-issued registration ticket");
  const result = await client.passkey.addPasskey({
    context,
    createSession: true,
    name: "Primary passkey",
  });
  if (result.error) throw new Error(result.error.message ?? "Passkey enrollment failed");
  const identity = await session();
  if (!identity) throw new Error("Passkey did not establish a session");
  return identity;
}

export async function signIn(): Promise<PrivateIdentity> {
  const result = await client.signIn.passkey();
  if (result.error) throw new Error(result.error.message ?? "Passkey sign-in failed");
  const identity = await session();
  if (!identity) throw new Error("Passkey sign-in did not establish a session");
  return identity;
}

export async function signOut(): Promise<void> {
  const result = await client.signOut();
  if (result.error) throw new Error(result.error.message ?? "Sign-out failed");
}
