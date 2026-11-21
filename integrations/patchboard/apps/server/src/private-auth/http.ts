import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "jazz-tools";
import { auth } from "./auth.ts";
import { privateAuthDatabase } from "./db.ts";
import { rememberJazzMemberIdentity } from "./member-directory.ts";
import { privateAuthConfig } from "./config.ts";
import { EnrollmentLimitReached, newRegistrationIntent } from "./enrollment.ts";
import { oauthConsentPage } from "./oauth-ui.ts";
import { createPendingGrant, discardGrant, grantBoardForConsent, withConsentGrant } from "./grants.ts";

/** Adapter between the Node HTTP server and Better Auth's Fetch API. */
async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", privateAuthConfig().origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  return new Request(url, {
    method, headers, body: req as unknown as ReadableStream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function sendFetchResponse(res: ServerResponse, response: Response) {
  const headers = new Headers(response.headers);
  const cookies = headers.getSetCookie();
  headers.delete("set-cookie");
  for (const [key, value] of headers) res.setHeader(key, value);
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function handlePrivateAuth(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  jazzAccountFor: (subject: string) => Promise<string>,
  afterAuth: (request: Request) => Promise<Response>,
): boolean {
  const pathname = new URL(req.url ?? "/", privateAuthConfig().origin).pathname;
  const wellKnown = pathname.startsWith("/.well-known/oauth-");
  if (!pathname.startsWith("/patchboard-auth/") &&
      !pathname.startsWith("/patchboard-private/api/") &&
      pathname !== "/patchboard-private/oauth-consent" && !wellKnown) {
    return false;
  }
  void (async () => {
    const request = await toFetchRequest(req);
    let response: Response;
    if (pathname === "/.well-known/oauth-authorization-server/patchboard-auth") {
      // RFC 8414 section 3: when an issuer contains a path, clients insert
      // /.well-known/oauth-authorization-server *before* its path component.
      // Better Auth publishes the same document under its basePath instead.
      // Keep exactly one public alias and preserve the issuer, endpoints and
      // provider-generated security metadata without synthesizing JSON.
      if (request.method !== "GET" && request.method !== "HEAD") {
        response = new Response(null, {
          status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" },
        });
      } else {
        const canonical = new URL(
          "/patchboard-auth/.well-known/oauth-authorization-server",
          privateAuthConfig().origin,
        );
        response = await auth.handler(new Request(canonical, {
          method: request.method, headers: request.headers,
        }));
      }
    } else if (pathname === "/patchboard-auth/oauth2/consent" && request.method === "POST") {
      // Validate the application-selected board BEFORE Better Auth issues the code.
      // The signed oauth_query and client redirect are then verified by the
      // official provider. The AsyncLocalStorage reference is per HTTP request.
      if (request.headers.get("origin") !== privateAuthConfig().origin) {
        response = Response.json({ error: "Origin not allowed" }, { status: 403 });
      } else {
        const session = await auth.api.getSession({ headers: request.headers });
        const input = await request.clone().json() as Record<string, unknown>;
        if (input.accept === false) {
          // Denying a connection needs no board selection and creates no grant.
          // The provider still validates the signed query and return URI.
          const { board_id: _selected, ...providerBody } = input;
          response = await auth.handler(new Request(request.url, {
            method: "POST", headers: request.headers,
            body: JSON.stringify(providerBody),
          }));
        } else {
        const requested = typeof input.oauth_query === "string"
          ? new URLSearchParams(input.oauth_query) : new URLSearchParams();
        const boardId = input.board_id;
        const clientId = requested.get("client_id");
        const boardValid = typeof boardId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boardId);
        if (!session || !boardValid || !clientId ||
          input.accept !== true || typeof input.oauth_query !== "string") {
          response = Response.json({ error: "Select a board and sign in" }, { status: 400 });
        } else {
          let allowed = false;
          try {
            const jazzAccountId = await jazzAccountFor(session.user.id);
            await grantBoardForConsent(db, boardId as string, jazzAccountId);
            // A ChatGPT-only member may consent without visiting Dim0 /me.
            // Record only the server-verified subject/account mapping.
            rememberJazzMemberIdentity(privateAuthDatabase(), jazzAccountId, session.user.id);
            allowed = true;
          } catch { /* Never expose private board existence in a consent error. */ }
          if (!allowed) {
            response = Response.json({ error: "Board permission denied" }, { status: 403 });
          } else {
            const grantId = createPendingGrant(session.user.id, clientId, boardId as string);
            let committed = false;
            try {
              // Do NOT inject board_id into Better Auth's strict consent schema.
              // Reconstruct the provider's original body without this app-only field.
              const { board_id: _selected, ...providerBody } = input;
              const providerRequest = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: JSON.stringify(providerBody),
              });
              response = await withConsentGrant(grantId, () => auth.handler(providerRequest));
              if (response.ok) {
                const payload = await response.clone().json().catch(() => ({})) as
                  { url?: string; redirect_uri?: string };
                const redirect = payload.url ?? payload.redirect_uri;
                // Persist the consent grant only when a real OAuth code exists.
                if (redirect) {
                  try {
                    const url = new URL(redirect);
                    committed = !!url.searchParams.get("code");
                  } catch { /* invalid redirect */ }
                }
              }
            } finally {
              if (!committed) discardGrant(grantId);
            }
          }
        }
        }
      }
    } else if (pathname.startsWith("/patchboard-auth/") || wellKnown) {
      response = await auth.handler(request);
    } else if (pathname === "/patchboard-private/oauth-consent") {
      response = await oauthConsentPage(request, db, jazzAccountFor);
    } else {
      if (request.method === "POST" && request.headers.get("origin") !== privateAuthConfig().origin) {
        response = Response.json({ error: "Origin not allowed" }, { status: 403 });
      } else if (pathname === "/patchboard-private/api/registration-intent" && request.method === "POST") {
        if (await auth.api.getSession({ headers: request.headers })) {
          response = Response.json({ error: "Sign out before registration" }, { status: 409 });
        } else {
          try {
            response = Response.json({ context: await newRegistrationIntent() }, {
              status: 201, headers: { "cache-control": "no-store" },
            });
          } catch (error) {
            if (!(error instanceof EnrollmentLimitReached)) throw error;
            response = Response.json({ error: "Registration temporarily limited" }, {
              status: 429, headers: { "cache-control": "no-store", "retry-after": "60" },
            });
          }
        }
      } else {
        response = await afterAuth(request);
      }
    }
    await sendFetchResponse(res, response);
  })().catch((error) => {
    console.error("Private auth request failed", error instanceof Error ? error.name : "Unknown");
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    if (!res.writableEnded) res.end('{"error":"Authentication unavailable"}');
  });
  return true;
}
