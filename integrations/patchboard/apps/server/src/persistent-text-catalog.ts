/** Explicit persistent Owner text-catalog profile, separate from QA/MCP.
 * An invalid enabled profile fails startup; default configuration is unchanged.
 * The operator must provision the private, non-temporary data directory.
 */
import {existsSync,lstatSync,realpathSync} from "node:fs";
import {isAbsolute,relative,resolve,sep} from "node:path";
import {tmpdir} from "node:os";

export function persistentTextCatalogEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if(env.PATCHBOARD_PERSISTENT_TEXT_CATALOG!=="1")return false;
  const invalid=():never=>{throw new Error("INVALID_PERSISTENT_TEXT_CATALOG_PROFILE");};
  if(env.PATCHBOARD_PRIVATE_DIM0_ONLY!=="1"||
    ["PATCHBOARD_PRIVATE_DEV","PATCHBOARD_OAUTH_CI_RESTART","PATCHBOARD_QA_TYPED_RECORD",
      "PATCHBOARD_QA_HTTPS_TEXT_TABLE","PATCHBOARD_ACC051_INFLIGHT_QA"].some(k=>env[k]==="1")||
    env.PATCHBOARD_PRIVATE_TEST_PID_FILE)invalid();
  const root=env.PATCHBOARD_PRIVATE_ROOT,origin=env.PATCHBOARD_PRIVATE_ORIGIN;
  if(!root||!isAbsolute(root)||!origin)return invalid();
  try{
    const url=new URL(origin);
    if(url.protocol!=="https:"||url.origin!==origin||url.username||url.password)invalid();
    const info=lstatSync(resolve(root));
    if(!info.isDirectory()||info.isSymbolicLink()||info.mode&0o077)invalid();
    const location=realpathSync(root);
    const temp=realpathSync(tmpdir());
    const within=(dir:string)=>{const r=relative(dir,location);return r===""||(!r.startsWith(".."+sep)&&r!==".."&&!isAbsolute(r));};
    if(within(temp)||(existsSync("/tmp")&&within(realpathSync("/tmp"))))invalid();
  }catch{return invalid();}
  return true;
}


/** Browser-only filtered sharing is a second explicit opt-in. Never widen
 * the OAuth issuer or the disposable QA tool/route inventory. */
export function persistentFilteredSharingEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if(env.PATCHBOARD_PERSISTENT_FILTERED_SHARING!=="1")return false;
  if(!persistentTextCatalogEnabled(env))throw new Error("INVALID_PERSISTENT_FILTERED_SHARING_PROFILE");
  return true;
}

/** Explicitly opt into the one board-scoped MCP table creation operation.
 * Independent of browser sharing, never a switch for the typed QA tools. */
export function persistentMcpTableCreateEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if(env.PATCHBOARD_PERSISTENT_MCP_TABLE_CREATE!=="1")return false;
  if(!persistentTextCatalogEnabled(env))throw new Error("INVALID_PERSISTENT_MCP_TABLE_CREATE_PROFILE");
  return true;
}
