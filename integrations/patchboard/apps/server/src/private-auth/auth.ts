import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { passkey } from "@better-auth/passkey";
import { privateAuthConfig } from "./config.ts";
import { privateAuthDatabase } from "./db.ts";
import { consentGrantReference, tokenBoardGrantClaim } from "./grants.ts";
import { typedRecordQaEnabled } from "../typed-record-qa-gate.ts";
import {qaHttpsCatalogProfile} from "../qa-https-catalog-profile.ts";
import { passkeyOnlyIdentitySchemaPlugin } from "./passkey-only-identity.ts";
import { resolveRegistrationIntent } from "./enrollment.ts";
import { finalizeVerifiedPasskeyRegistration } from "./finalize-registration.ts";

// Validate the opt-in before auth configuration creates any store or secret.
const httpsCatalog = qaHttpsCatalogProfile();
const config = privateAuthConfig();
// ChatGPT’s custom MCP connector currently requests board:read/write without
// offline_access. Keep the production 15-minute default, but allow an explicit,
// bounded extension for a time-limited live presentation (never disable OAuth).
const accessTokenSeconds = (() => {
  const configured = process.env.PATCHBOARD_MCP_ACCESS_TOKEN_SECONDS;
  if (configured === undefined) return 900;
  const seconds = Number(configured);
  if (!Number.isInteger(seconds) || seconds < 900 || seconds > 21600) {
    throw new Error("PATCHBOARD_MCP_ACCESS_TOKEN_SECONDS must be 900..21600");
  }
  return seconds;
})();

export const auth = betterAuth({
  baseURL: config.origin,
  basePath: "/patchboard-auth",
  secret: config.secret,
  trustedOrigins: [config.origin],
  database: privateAuthDatabase(),
  rateLimit: { enabled: true, window: 10, max: 100 },
  emailAndPassword: { enabled: false },
  plugins: [
    jwt(),
    mcp({
      resource: config.origin + "/patchboard-private-mcp",
      loginPage: process.env.PATCHBOARD_PRIVATE_DIM0_ONLY === "1"
        ? "/signin" : "/patchboard-private/",
      consentPage: "/patchboard-private/oauth-consent",
      // The installed Better Auth OAuth provider preserves consent referenceId
      // across the authorization code and refresh token. AsyncLocalStorage
      // isolates simultaneous consent tabs and prevents a global board choice.
      postLogin: {
        page: "/patchboard-private/oauth-consent",
        shouldRedirect: async () => false,
        consentReferenceId: async () => consentGrantReference(),
      },
      customAccessTokenClaims: async ({ referenceId, user }) =>
        tokenBoardGrantClaim(referenceId, user?.id),
      // offline_access permits a refresh token; the referenceId survives
      // rotation, so it cannot widen a consented single-board grant.
      // Explicit opt-in QA action: source table|create -> Dim0 table:create.
      // Never part of OAuth's default client scopes or production issuer.
      scopes: ["board:read", "board:write", "offline_access",
        ...((typedRecordQaEnabled()||httpsCatalog) ? ["table:create"] : [])],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultScopes: ["board:read", "board:write"],
      clientRegistrationAllowedScopes: ["offline_access",
        ...((typedRecordQaEnabled()||httpsCatalog) ? ["table:create"] : [])],
      accessTokenExpiresIn: accessTokenSeconds,
      refreshTokenExpiresIn: 604800,
    }) as unknown as import("better-auth").BetterAuthPlugin,
    // OAuth Provider 1.7.1 exposes strict OpenAPI schema metadata which is not
    // structurally compatible with Better Auth plugin metadata types in TS.
    // Preserve the official runtime plugin; do not weaken token verification.
    passkey({
      rpID: new URL(config.origin).hostname,
      rpName: process.env.PATCHBOARD_PRIVATE_DIM0_ONLY === "1" ? "Dim0" : "Patchboard",
      origin: config.origin,
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      registration: {
        requireSession: false,
        resolveUser: async ({ context }) => resolveRegistrationIntent(context),
        afterVerification: async ({ user, context, ctx }) =>
          finalizeVerifiedPasskeyRegistration(
            context, user.id,
            async (id) => Boolean(await ctx.context.internalAdapter.findUserById(id)),
            async (intent) => {
              await ctx.context.internalAdapter.createUser({
                id: intent.id,
                name: intent.name,
                email: undefined as unknown as string,
                emailVerified: false,
              }, { method: "passkey" });
            },
          ),
      },
    }),
    passkeyOnlyIdentitySchemaPlugin(),
  ],
});
