/**
 * Explicitly disabled in production. This first typed-record slice is a
 * disposable QA pilot, NOT a new implicit entitlement for old board:write
 * consents. A separately versioned consent action is required for rollout.
 */
import {basename,dirname} from "node:path";
import {realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {privateAuthConfig} from "./private-auth/config.ts";

export function typedRecordQaEnabled():boolean{
  if(process.env.PATCHBOARD_QA_TYPED_RECORD!=="1" ||
    process.env.PATCHBOARD_PRIVATE_DEV!=="1" ||
    process.env.PATCHBOARD_OAUTH_CI_RESTART!=="1")return false;
  const config=privateAuthConfig();
  const url=new URL(config.origin);
  if(url.protocol!=="http:" ||
    !["localhost","127.0.0.1","[::1]"].includes(url.hostname))return false;
  // Resolve symlinks and require a direct disposable child of the real temp root.
  try{
    const root=realpathSync(config.root);
    return dirname(root)===realpathSync(tmpdir()) &&
      basename(root).startsWith("patchboard-private-ci-");
  }catch{return false;}
}
