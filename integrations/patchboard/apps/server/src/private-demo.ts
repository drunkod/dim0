import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startBoardServer } from "./http-server.ts";
import { auth } from "./private-auth/auth.ts";
import { privateBoardRequest } from "./private-board-routes.ts";
import { handlePrivateCanvasStream } from "./private-canvas-stream.ts";
import {qaHttpsCatalogProfile} from "./qa-https-catalog-profile.ts";
import { privateAuthConfig } from "./private-auth/config.ts";
import { closePrivateAuthDatabase } from "./private-auth/db.ts";
import { handlePrivateAuth } from "./private-auth/http.ts";
import { handlePrivateMcp } from "./private-mcp.ts";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };

const httpsCatalog = qaHttpsCatalogProfile();
const config = privateAuthConfig();
const staticDir = resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
const jazzDataPath = join(config.root, "jazz");
if (jazzDataPath === config.databasePath || jazzDataPath.includes("/patchboard-nov21/")) {
  throw new Error("Private Jazz and Better Auth stores must be separate from the guest demo");
}
const server = await startBoardServer({
  port: config.port,
  staticDir,
  publicPath: "/patchboard-private",
  publicOrigin: config.origin,
  dataPath: jazzDataPath,
  privatePermissions,
  authenticate: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null; // CRITICAL: no acceptDeviceAccounts
    return {
      userId: session.user.id,
      expiresAt: Math.floor(session.session.expiresAt.getTime() / 1000),
    };
  },
  extraHandler: (request, response, db) => {
    if(httpsCatalog){
      // Reject a wrong Host, including the health and legacy entry routes.
      if(request.headers.host!==new URL(httpsCatalog.origin).host){
        response.writeHead(421,{"cache-control":"no-store"});response.end();return true;
      }
      // Expired or altered seal closes the profile instead of falling back.
      try {
        const live=qaHttpsCatalogProfile();
        if(!live||live.origin!==httpsCatalog.origin||live.boardId!==httpsCatalog.boardId||
          live.root!==httpsCatalog.root||live.createdAtMs!==httpsCatalog.createdAtMs)
          throw new Error("QA profile changed");
      } catch {
        response.writeHead(503,{"cache-control":"no-store"});response.end();return true;
      }
    }
    return handlePrivateCanvasStream(request, response, db, (subject) => server.jazz.createAccountFor(subject)) ||
    handlePrivateAuth(request, response, db, (subject) => server.jazz.createAccountFor(subject),
      (received) => privateBoardRequest(received, db,
        (subject) => server.jazz.createAccountFor(subject)),
    ) || handlePrivateMcp(request, response, db, (subject) => server.jazz.createAccountFor(subject));
  },
});
// Test-only process identification, never enabled for public HTTPS.
const testPidPath = process.env.PATCHBOARD_PRIVATE_TEST_PID_FILE;
if (testPidPath) {
  if (process.env.PATCHBOARD_PRIVATE_DEV !== "1" ||
      testPidPath !== join(config.root, "qa-private-server.pid")) {
    throw new Error("Test PID file must be inside an explicit private loopback fixture");
  }
  writeFileSync(testPidPath, String(process.pid), { mode: 0o600 });
}
console.log("PRIVATE_AUTH_READY", JSON.stringify({
  origin: config.origin,
  port: server.port,
  authDb: config.databasePath,
  jazzStore: jazzDataPath,
  public: false,
}));
let closed = false;
async function stop() {
  if (closed) return;
  closed = true;
  await server.close();
  closePrivateAuthDatabase();
}
process.once("SIGINT", () => { void stop().then(() => process.exit()); });
process.once("SIGTERM", () => { void stop().then(() => process.exit()); });
