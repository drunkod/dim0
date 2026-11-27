/**
 * Real self-profile HTTP adapter. Outer private-board-routes.ts supplies the
 * authenticated Better Auth session; it never accepts a subject from JSON.
 * Display-name mutation goes through the installed Better Auth 1.7.1
 * auth.api.updateUser endpoint. Locale lives only in server-private SQLite.
 * No email is required or synthesized; no password/backup factor UI enabled.
 */
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { normalizedDisplayName, normalizedAccountLocale } from "@patchboard/account-domain/profile";
import { ProfileConflict, readAccountPreferences, updateAccountPreferences } from "./profile-preferences.ts";
import { GrantOwnerError, listCurrentSubjectGrants, revokeVerifiedSubjectGrant }
  from "./grant-admission.ts";

type VerifiedSessionUser = Readonly<{ id: string; name: string }>;
type NameUpdater = (name: string, headers: Headers) => Promise<boolean>;
const json = (data: unknown, status = 200) =>
  Response.json(data, {status, headers:{
    "cache-control":"no-store", "referrer-policy":"no-referrer"
  }});
async function safeJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("INVALID_PROFILE_CONTENT_TYPE");
  if (Number(request.headers.get("content-length")) > 4096)
    throw new Error("INVALID_PROFILE_BODY");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 4096) throw new Error("INVALID_PROFILE_BODY");
  return JSON.parse(raw) as unknown;
}
const localeCommand = z.object({
  locale:z.string().max(35),
  expected_version:z.number().int().min(0),
  request_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
}).strict();

export async function privateAccountProfileRequest(
  request: Request,
  verifiedUser: VerifiedSessionUser,
  db: DatabaseSync,
  updateName: NameUpdater
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/patchboard-private/api/account/")) return null;
  // This is a session-bound adapter. The outer entry MUST verify Better Auth
  // before constructing verifiedUser. No browser-supplied subject here.
  if (!verifiedUser.id) return json({error:"UNAUTHENTICATED"},401);
  const isProfile = pathname === "/patchboard-private/api/account/profile";
  const isPreferences = pathname === "/patchboard-private/api/account/preferences";
  const isActivity = pathname === "/patchboard-private/api/account/activity";
  const isConnectedApps = pathname === "/patchboard-private/api/account/connected-apps";
  const isConnectedRevoke = pathname === "/patchboard-private/api/account/connected-apps/revoke";
  if (!isProfile && !isPreferences && !isActivity && !isConnectedApps && !isConnectedRevoke)
    return json({error:"Not found"},404);
  const preferences = readAccountPreferences(db, verifiedUser.id);
  if (request.method === "GET") {
    if (isConnectedApps) return json(listCurrentSubjectGrants(db,verifiedUser.id));
    if (isConnectedRevoke) return json({error:"METHOD_NOT_ALLOWED"},405);
    if (isProfile) return json({
      display_name:verifiedUser.name, locale:preferences.locale,
      version:preferences.version, email_required:false,
      backup_passkey_enrollment_available:false
    });
    if (isPreferences) return json(preferences);
    const rows = db.prepare(`SELECT event_type,occurred_at_ms,safe_metadata
      FROM patchboard_account_activity WHERE subject_id=?
      ORDER BY occurred_at_ms DESC LIMIT 50`).all(verifiedUser.id) as
      {event_type:string; occurred_at_ms:number; safe_metadata:string}[];
    return json({events:rows.map(row => ({
      type:row.event_type, at:row.occurred_at_ms,
      // Only our own non-PII locale event currently uses this table.
      detail:JSON.parse(row.safe_metadata) as unknown
    }))});
  }
  if (isConnectedRevoke && request.method === "POST") {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({error:"ORIGIN_MISMATCH"},403);
    try {
      const parsed = z.object({
        grant_id:z.string().uuid(),client_id:z.string().min(1).max(256),
        expected_version:z.number().int().positive(),
        request_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      }).strict().parse(await safeJson(request));
      const receipt=revokeVerifiedSubjectGrant(db,verifiedUser.id,{
        grantId:parsed.grant_id,clientId:parsed.client_id,
        expectedVersion:parsed.expected_version,requestId:parsed.request_id
      });
      return json({grant_id:receipt.id,version:receipt.committedVersion,
        revoked_at_ms:receipt.revokedAtMs});
    } catch(error) {
      if (error instanceof GrantOwnerError)
        return json({error:error.code},error.code==="FORBIDDEN"?403:409);
      if (error instanceof z.ZodError || error instanceof SyntaxError ||
          error instanceof Error && error.message.startsWith("INVALID_"))
        return json({error:"INVALID_CONNECTED_APP_REQUEST"},400);
      throw error;
    }
  }
  if (request.method !== "PATCH" || isConnectedApps || isConnectedRevoke)
    return json({error:"METHOD_NOT_ALLOWED"},405);
  // Sensitive cookie-authenticated settings mutations require explicit
  // same-origin browser intent; absent/cross-origin Origin is NOT trusted.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({error:"ORIGIN_MISMATCH"},403);
  try {
    const body = await safeJson(request);
    if (isActivity) return json({error:"METHOD_NOT_ALLOWED"},405);
    if (isProfile) {
      const parsed = z.object({display_name:z.string()}).strict().parse(body);
      const displayName = normalizedDisplayName(parsed.display_name);
      // Better Auth verifies the SAME session again from request headers;
      // no direct SQL update of its user table or session impersonation.
      const updated = await updateName(displayName, request.headers);
      if (!updated) return json({error:"PROFILE_UPDATE_UNAVAILABLE"},503);
      return json({display_name:displayName, updated:true});
    }
    const parsed = localeCommand.parse(body);
    normalizedAccountLocale(parsed.locale);
    const result = updateAccountPreferences(db, verifiedUser.id, {
      locale:parsed.locale,expectedVersion:parsed.expected_version,
      requestId:parsed.request_id
    });
    return json({locale:result.locale,version:result.version,changed:result.changed});
  } catch (error) {
    if (error instanceof ProfileConflict) return json({error:error.code},409);
    if (error instanceof z.ZodError || error instanceof SyntaxError ||
        error instanceof Error && error.message.startsWith("INVALID_"))
      return json({error:"INVALID_ACCOUNT_PROFILE_INPUT"},400);
    throw error;
  }
}
