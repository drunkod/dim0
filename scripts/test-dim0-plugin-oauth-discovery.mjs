#!/usr/bin/env node
/**
 * Read-only, live OAuth discovery rehearsal through the public MCP URL.
 * Never creates a client, logs in, handles secrets, or changes a board.
 */
import assert from "node:assert/strict";

const raw = process.env.DIM0_MCP_URL;
assert.ok(raw, "Set DIM0_MCP_URL to the exact public HTTPS MCP endpoint");
const endpoint = new URL(raw);
assert.equal(endpoint.protocol, "https:");
assert.equal(endpoint.pathname, "/patchboard-private-mcp");
assert.equal(endpoint.search, "");
assert.equal(endpoint.hash, "");
assert.equal(endpoint.username, "");
assert.equal(endpoint.password, "");

const challenge = await fetch(endpoint, { method: "GET", redirect: "manual" });
assert.equal(challenge.status, 401, "MCP must require OAuth instead of a passkey cookie");
const authenticate = challenge.headers.get("www-authenticate") || "";
assert.match(authenticate, /^Bearer\b/i);
const link = authenticate.match(/resource_metadata="([^"]+)"/);
assert.ok(link, "MCP bearer challenge must advertise RFC 9728 resource metadata");
const resourceMetadata = new URL(link[1]);
assert.equal(resourceMetadata.origin, endpoint.origin);
assert.equal(resourceMetadata.pathname,
  "/.well-known/oauth-protected-resource/patchboard-private-mcp");
const resourceResponse = await fetch(resourceMetadata);
assert.equal(resourceResponse.status, 200);
const resource = await resourceResponse.json();
assert.equal(resource.resource, endpoint.href);
assert.ok(Array.isArray(resource.authorization_servers));
assert.ok(resource.authorization_servers.length > 0);

const issuer = new URL(resource.authorization_servers[0]);
assert.equal(issuer.origin, endpoint.origin);
assert.equal(issuer.pathname, "/patchboard-auth");
const metadataURL = new URL(
  "/.well-known/oauth-authorization-server" + issuer.pathname, issuer.origin,
);
const discovery = await fetch(metadataURL);
assert.equal(discovery.status, 200);
const provider = await discovery.json();
assert.equal(provider.issuer, issuer.href.replace(/\/$/, ""));
assert.ok(provider.code_challenge_methods_supported?.includes("S256"),
  "Authorization code flow must support PKCE S256");
for (const key of [
  "registration_endpoint", "authorization_endpoint", "token_endpoint",
]) {
  assert.equal(typeof provider[key], "string", key + " is required");
  const uri = new URL(provider[key]);
  assert.equal(uri.origin, endpoint.origin);
  assert.ok(uri.pathname.startsWith(issuer.pathname + "/"));
}
console.log("DIM0_PLUGIN_OAUTH_DISCOVERY_PASS", JSON.stringify({
  resource: endpoint.href,
  issuer: provider.issuer,
  dcr: provider.registration_endpoint,
  authorization: provider.authorization_endpoint,
  token: provider.token_endpoint,
  pkce: "S256",
  bearerChallenge: challenge.status,
}));
