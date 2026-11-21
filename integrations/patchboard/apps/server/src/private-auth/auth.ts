import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { passkey } from "@better-auth/passkey";
import { privateAuthConfig } from "./config.ts";
import { privateAuthDatabase } from "./db.ts";
import { consentGrantReference, tokenBoardGrantClaim } from "./grants.ts";
import { passkeyOnlyIdentitySchemaPlugin } from "./passkey-only-identity.ts";
import { resolveRegistrationIntent } from "./enrollment.ts";
import { finalizeVerifiedPasskeyRegistration } from "./finalize-registration.ts";

const config = privateAuthConfig();
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
      loginPage: "/patchboard-private/",
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
      scopes: ["board:read", "board:write", "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultScopes: ["board:read", "board:write"],
      clientRegistrationAllowedScopes: ["offline_access"],
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 604800,
    }) as unknown as import("better-auth").BetterAuthPlugin,
    // OAuth Provider 1.7.1 exposes strict OpenAPI schema metadata which is not
    // structurally compatible with Better Auth plugin metadata types in TS.
    // Preserve the official runtime plugin; do not weaken token verification.
    passkey({
      rpID: new URL(config.origin).hostname,
      rpName: "Patchboard",
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
