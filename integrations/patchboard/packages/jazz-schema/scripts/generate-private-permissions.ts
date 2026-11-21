import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { privatePermissions } from "../private-permissions.ts";

const readable = privatePermissions[Symbol.for("jazz.permissions.readable") as keyof typeof privatePermissions];
if (!readable || typeof readable !== "object") {
  throw new Error("Jazz private permission DSL did not produce a compiled policy");
}
const file = fileURLToPath(new URL("../private.permissions.json", import.meta.url));
const expected = JSON.stringify(readable, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const existing = await readFile(file, "utf8");
  if (existing !== expected) throw new Error("Private permissions JSON is outdated; regenerate it");
  console.log("PRIVATE_JAZZ_PERMISSIONS_CURRENT", file);
} else {
  await writeFile(file, expected);
  console.log("PRIVATE_JAZZ_PERMISSIONS_GENERATED", file);
}
