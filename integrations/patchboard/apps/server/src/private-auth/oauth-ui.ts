import { randomBytes } from "node:crypto";
import type { Db } from "jazz-tools";
import { auth } from "./auth.ts";
import { listPrivateBoards } from "./grants.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? "");

/** A local-only consent UI; never display or accept client-supplied redirects. */
export async function oauthConsentPage(
  request: Request,
  db: Db,
  jazzAccountFor: (subject: string) => Promise<string>,
): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
  const session = await auth.api.getSession({ headers: request.headers });
  const url = new URL(request.url);
  if (!session) {
    const login = new URL(process.env.PATCHBOARD_PRIVATE_DIM0_ONLY === "1"
      ? "/jazz-signin" : "/patchboard-private/", url);
    login.search = url.search; // signed authorization continuation, not an arbitrary redirect
    return Response.redirect(login, 302);
  }
  const nonce = randomBytes(20).toString("base64");
  const clientId = escapeHtml(url.searchParams.get("client_id") ?? "Unknown client");
  const requestedScopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  const scopeList = requestedScopes.map(scope => "<li>" + escapeHtml(scope) + "</li>").join("");
  const boards = await listPrivateBoards(db, await jazzAccountFor(session.user.id));
  const options = boards.map(board =>
    '<option value="' + escapeHtml(board.board_id) + '">' +
    escapeHtml(board.title) + " (" + escapeHtml(board.role) + ")</option>"
  ).join("");
  const appName = process.env.PATCHBOARD_PRIVATE_DIM0_ONLY === "1" ? "Dim0" : "Patchboard";
  const content = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + appName + ' — authorize MCP</title>',
    '<style>body{font:16px system-ui,sans-serif;background:#f5f6fa;color:#17212e;margin:0;padding:4rem 1rem}',
    'main{max-width:550px;margin:auto;background:white;border-radius:14px;padding:2rem}',
    'button{padding:.7rem 1.3rem;border-radius:7px;border:1px solid #3a5268;cursor:pointer}',
    'button.approve{background:#12365e;color:white}#status{color:#a23d39}code{overflow-wrap:anywhere}</style>',
    '</head><body><main><h1>Authorize a ' + appName + ' connection</h1>',
    '<p>A third-party MCP client requests access as <strong>', escapeHtml(session.user.name), '</strong>.</p>',
    '<p><strong>Client ID</strong>: <code>', clientId, '</code></p>',
    '<p>Requested scopes:</p><ul>', scopeList || "<li>No board permissions requested</li>", '</ul>',
    '<p><strong>Choose the one board this connection may access.</strong> ',
    'No other board names, notes or writes will be available to this MCP client.</p>',
    '<label for="board">Approved board</label> ',
    '<select id="board" required><option value="">Select a board...</option>', options, '</select>',
    '<p>A viewer may read the selected board, never write it. Your passkey session ',
    'is not an MCP credential. Access tokens expire after ',
    String(Math.round(Number(process.env.PATCHBOARD_MCP_ACCESS_TOKEN_SECONDS ?? '900') / 60)),
    ' minutes.</p>',
    '<button class="approve" id="approve" disabled>Authorize selected board</button> ',
    '<button id="deny">Deny</button><p role="alert" id="status"></p></main>',
    '<script nonce="', nonce, '">',
    'const query = location.search.slice(1);',
    'const status = document.getElementById("status");',
    'const selection = document.getElementById("board");',
    'selection.addEventListener("change",()=>{document.getElementById("approve").disabled=!selection.value});',
    'async function decide(accept) {',
    'if(accept&&!selection.value){status.textContent="Choose a board";return;}',
    'document.getElementById("approve").disabled = true;',
    'document.getElementById("deny").disabled = true;',
    'try { const res = await fetch("/patchboard-auth/oauth2/consent", {',
    'method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},',
    'body:JSON.stringify({accept,oauth_query:query,board_id:selection.value})});',
    'const payload = await res.json();',
    'const target = payload.url ?? payload.redirect_uri;',
    'if(!res.ok || typeof target !== "string")',
    'throw new Error(payload.error_description || payload.message || payload.error || "Authorization failed");',
    'location.assign(target);',
    '} catch(error) { status.textContent = String(error);',
    'document.getElementById("approve").disabled=!selection.value;document.getElementById("deny").disabled=false;',
    '}}',
    'document.getElementById("approve").addEventListener("click",()=>decide(true));',
    'document.getElementById("deny").addEventListener("click",()=>decide(false));',
    '</script></body></html>',
  ].join("");
  return new Response(content, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; script-src 'nonce-" + nonce +
        "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
