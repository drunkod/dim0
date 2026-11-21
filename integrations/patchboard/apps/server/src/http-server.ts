import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { handleBoardMcp } from "./mcp.ts";
import { acceptDeviceAccounts, createJazz, sqlite } from "jazz-tools/backend";
import type { CreateJazzOptions } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/jazz.permissions.json" with { type: "json" };

type DemoBoardResolver = string | (() => string | undefined);

export async function startBoardServer(
  options: {
    port?: number;
    demoBoardId?: DemoBoardResolver;
    webPort?: number;
    dataPath?: string;
    staticDir?: string;
    publicPath?: string;
    publicOrigin?: string;
    /** Only the dedicated private entry point supplies these overrides. */
    privatePermissions?: CreateJazzOptions["permissions"];
    authenticate?: CreateJazzOptions["authenticate"];
    extraHandler?: (
      request: import("node:http").IncomingMessage,
      response: import("node:http").ServerResponse,
      db: import("jazz-tools").Db,
    ) => boolean;
  } = {},
) {
  process.env.JAZZ_APP_DIR = new URL("../../../packages/jazz-schema", import.meta.url).pathname;
  const port = options.port ?? Number(process.env.PORT ?? "3001");
  const webPort = options.webPort ?? Number(process.env.PATCHBOARD_WEB_PORT ?? "4173");
  const dataPath = options.dataPath ?? process.env.PATCHBOARD_DATA_PATH ?? ".jazz/m1";
  const staticDir = options.staticDir;
  const publicPath = options.publicPath ?? "/patchboard";
  const jazzPath = staticDir ? publicPath + "/jazz" : "/jazz";
  const resolveDemoBoard = () =>
    typeof options.demoBoardId === "function" ? options.demoBoardId() : options.demoBoardId;
  const jazz = await createJazz({
    app,
    permissions: options.privatePermissions ?? permissions,
    store: sqlite({ path: dataPath }),
    authenticate: options.authenticate ?? acceptDeviceAccounts,
    ...(staticDir ? { basePath: jazzPath } : {}),
    publicUrl: staticDir
      ? [options.publicOrigin ? options.publicOrigin + jazzPath : `http://127.0.0.1:${webPort}${jazzPath}`, `http://127.0.0.1:${port}${jazzPath}`]
      : [options.publicOrigin ? options.publicOrigin + "/jazz" : `http://127.0.0.1:${webPort}/jazz`, `http://127.0.0.1:${port}/jazz`],
    allowedOrigins: [options.publicOrigin ?? `http://127.0.0.1:${webPort}`, `http://127.0.0.1:${port}`],
  }).ready();

  const server = createServer((request, response) => {
    if (options.extraHandler?.(request, response, jazz.db)) return;
    const demoBoardId = resolveDemoBoard();
    if (request.url === "/patchboard-mcp" && demoBoardId) {
      void handleBoardMcp(request, response, jazz.db, () => demoBoardId);
      return;
    }
    if (staticDir && request.url?.startsWith(jazzPath)) {
      response.setHeader("Access-Control-Allow-Origin", options.publicOrigin ?? `http://127.0.0.1:${webPort}`);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // Jazz must receive the prefixed HTTP and WebSocket handshake before the
      // static asset fallback can interpret the path as a file.
      jazz.nodeHandler(request, response, () => { response.writeHead(404); response.end("Not found"); });
      return;
    }
    if (request.url?.startsWith(jazzPath)) {
      response.setHeader("Access-Control-Allow-Origin", options.publicOrigin ?? `http://127.0.0.1:${webPort}`);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    // In the Dim0 unified deployment, the old Patchboard frontend must not
    // appear during sign-in. Its Jazz WebSocket and auth APIs remain available.
    if (process.env.PATCHBOARD_PRIVATE_DIM0_ONLY === "1" && staticDir &&
        request.method === "GET" &&
        /^\/patchboard-private(?:\/|\/index\.html)?(?:\?.*)?$/.test(request.url ?? "")) {
      const query = (request.url ?? "").split("?")[1] ?? "";
      response.writeHead(302, { Location: "/jazz-signin" + (query ? "?" + query : ""),
        "cache-control": "no-store" });
      response.end();
      return;
    }
    if (staticDir && request.method === "GET" && request.url?.startsWith(publicPath)) {
      const requested = decodeURIComponent(request.url.slice(publicPath.length).split("?")[0] || "/");
      const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
      const file = normalize(join(staticDir, relative));
      if (!file.startsWith(normalize(staticDir) + "/")) {
        response.writeHead(400);
        response.end("Bad path");
        return;
      }
      void stat(file).then(info => {
        const target = info.isDirectory() ? join(file, "index.html") : file;
        const contentType = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml" }[extname(target)] ?? "application/octet-stream";
        response.writeHead(200, { "content-type": contentType });
        createReadStream(target).pipe(response);
      }).catch(() => { response.writeHead(404); response.end("Not found"); });
      return;
    }
    jazz.nodeHandler(request, response, () => { response.writeHead(404); response.end("Not found"); });
  });

  try {
    await jazz.attach(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    await jazz.close();
    throw error;
  }

  let closing = false;
  return {
    jazz,
    port: (server.address() as import("node:net").AddressInfo).port,
    dataPath,
    async close() {
      if (closing) return;
      closing = true;
      await jazz.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
