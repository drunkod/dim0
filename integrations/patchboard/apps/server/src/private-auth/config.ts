import { mkdirSync, readFileSync, openSync, closeSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

export type PrivateAuthConfig = Readonly<{
  origin: string;
  port: number;
  root: string;
  databasePath: string;
  secret: string;
}>;

let configured: PrivateAuthConfig | undefined;

export function privateAuthConfig(): PrivateAuthConfig {
  if (configured) return configured;
  const root = process.env.PATCHBOARD_PRIVATE_ROOT;
  const origin = process.env.PATCHBOARD_PRIVATE_ORIGIN;
  if (!root || !isAbsolute(root) || !origin) {
    throw new Error("PATCHBOARD_PRIVATE_ROOT must be absolute and PATCHBOARD_PRIVATE_ORIGIN must be configured");
  }
  const rootPath = resolve(root);
  const knownGuestRoot = "/Users/test/work/patchwork/demo/patchboard-nov21";
  if (rootPath === knownGuestRoot || rootPath.startsWith(knownGuestRoot + "/")) {
    throw new Error("Private auth may not use the existing guest demo data directory");
  }
  const url = new URL(origin);
  if (origin !== url.origin || url.username || url.password) {
    throw new Error("PATCHBOARD_PRIVATE_ORIGIN must be a canonical origin with no path or credentials");
  }
  const devLoopback = process.env.PATCHBOARD_PRIVATE_DEV === "1" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !devLoopback) {
    throw new Error("Private sign-in requires HTTPS or explicit development loopback");
  }
  const port = Number(process.env.PATCHBOARD_PRIVATE_PORT ?? "8792");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid private server port");
  }
  mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  mkdirSync(join(rootPath, "auth"), { recursive: true, mode: 0o700 });
  const secretPath = join(rootPath, "auth", "better-auth-secret");
  let secret: string;
  try {
    secret = readFileSync(secretPath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const initial = randomBytes(48).toString("base64url");
    try {
      const fd = openSync(secretPath, "wx", 0o600);
      try {
        writeFileSync(fd, initial + "\n");
      } finally {
        closeSync(fd);
      }
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
    }
    secret = readFileSync(secretPath, "utf8").trim();
  }
  if (secret.length < 32) throw new Error("Private auth secret is too short");
  chmodSync(secretPath, 0o600);
  return (configured = Object.freeze({
    origin, port, root: rootPath, databasePath: join(rootPath, "auth", "better-auth.sqlite"), secret,
  }));
}
