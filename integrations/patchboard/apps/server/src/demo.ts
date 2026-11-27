import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app } from "@patchboard/jazz-schema";
import { startBoardServer } from "./http-server.ts";

const root = resolve(process.env.PATCHBOARD_DEMO_ROOT ?? ".patchboard-demo");
const dataPath = resolve(process.env.PATCHBOARD_DATA_PATH ?? root + "/jazz");
const staticDir = resolve(process.env.PATCHBOARD_STATIC_DIR ?? new URL("../../../apps/web/dist", import.meta.url).pathname);
const port = Number(process.env.PATCHBOARD_DEMO_PORT ?? "8791");
const publicPath = process.env.PATCHBOARD_PUBLIC_PATH ?? "/patchboard";
const publicOrigin = process.env.PATCHBOARD_PUBLIC_ORIGIN ?? "http://127.0.0.1:" + port;
const configuredBoardId = process.env.PATCHBOARD_DEMO_BOARD_ID;
const boardIdPath = resolve(process.env.PATCHBOARD_DEMO_BOARD_ID_FILE ?? root + "/board-id");
let demoBoardId = configuredBoardId;
if (!demoBoardId) {
  try {
    demoBoardId = (await readFile(boardIdPath, "utf8")).trim() || undefined;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("Unable to read demo board ID file " + boardIdPath + ": " + message);
    }
  }
}

await mkdir(root, { recursive: true });
await mkdir(dataPath, { recursive: true });
await stat(staticDir);
const indexHtml = await readFile(resolve(staticDir, "index.html"), "utf8");
const entryAsset = indexHtml.match(/(?:src|href)="([^"]+\.(?:js|css))"/)?.[1];
if (!entryAsset) throw new Error("Built bundle has no entry asset in " + resolve(staticDir, "index.html"));
const entryRelative = entryAsset.replace(new RegExp("^" + publicPath), "").replace(/^\/+/, "");
await stat(resolve(staticDir, entryRelative));

const running = await startBoardServer({
  port,
  webPort: port,
  dataPath,
  staticDir,
  publicPath,
  publicOrigin,
  demoBoardId: () => demoBoardId,
});
const existing = demoBoardId
  ? await running.jazz.db.one(app.boards.where({ id: demoBoardId }))
  : await running.jazz.db.one(app.boards.where({ title: "Patchboard demo" }));

if (!existing) {
  if (configuredBoardId || demoBoardId) {
    await running.close();
    throw new Error("PATCHBOARD_DEMO_BOARD_ID is configured but the board does not exist: " + demoBoardId);
  }
  const created = running.jazz.db.insert(app.boards, { title: "Patchboard demo", ownerId: randomUUID() });
  await created.wait({ tier: "global" });
  demoBoardId = created.value.id;
  await writeFile(boardIdPath, demoBoardId + "\n", { encoding: "utf8", flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
    demoBoardId = (await readFile(boardIdPath, "utf8")).trim();
  });
} else {
  demoBoardId = existing.id;
  await writeFile(boardIdPath, demoBoardId + "\n", { encoding: "utf8" });
}

console.log("Patchboard demo: " + publicOrigin + publicPath + "/?board=" + demoBoardId);
// The public Funnel root belongs to another app; /health is local to this listener.
console.log("Health (local only): http://127.0.0.1:" + port + "/health");

const shutdown = async () => { await running.close(); };
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
