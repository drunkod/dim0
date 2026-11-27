/**
 * Isolated, opt-in HTTPS QA ONLY. Does not run a reverse proxy, make a public
 * listener or grant product-owner authorization to expose a service.
 *
 * The exact HTTPS issuer, permitted board, verified fresh disposable root
 * and short-lived boot proof must agree before OAuth can advertise
 * table:create. The existing loopback ACC-051 CI gate stays unchanged.
 */
import { readFileSync,realpathSync,statSync,lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,isAbsolute,join,resolve } from "node:path";

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const qaPrefix="dim0-plugin-https-qa-";
const signature="dim0-plugin-https-qa/v1";
export const QA_HTTPS_PROFILE_PROOF_FILE=".qa-catalog-profile.json";
export type QaHttpsCatalogProfile=Readonly<{
  origin:string;boardId:string;root:string;createdAtMs:number;
}>;
export class QaHttpsCatalogProfileInvalid extends Error{
  constructor(){super("INVALID_ISOLATED_HTTPS_QA_PROFILE");}
}
const invalid=():never=>{throw new QaHttpsCatalogProfileInvalid();};

/** Opt-in is intentionally separate from PATCHBOARD_QA_TYPED_RECORD.
 * Invalid opt-in MUST abort boot, never fall through to production behavior.
 */
export function qaHttpsCatalogProfile():QaHttpsCatalogProfile|null{
  if(process.env.PATCHBOARD_QA_HTTPS_TEXT_TABLE!=="1")return null;
  if(process.env.PATCHBOARD_PRIVATE_DEV!=="1" ||
    process.env.PATCHBOARD_OAUTH_CI_RESTART!=="1" ||
    process.env.PATCHBOARD_QA_TYPED_RECORD==="1" ||
    process.env.PATCHBOARD_PRIVATE_DIM0_ONLY!=="1" ||
    process.env.PATCHBOARD_ACC051_INFLIGHT_QA==="1" ||
    process.env.PATCHBOARD_PRIVATE_TEST_PID_FILE)invalid();
  const configuredRoot=process.env.PATCHBOARD_PRIVATE_ROOT;
  if(!configuredRoot||!isAbsolute(configuredRoot))return invalid();
  const expected=process.env.PATCHBOARD_QA_HTTPS_ORIGIN;
  const boardId=process.env.PATCHBOARD_QA_HTTPS_BOARD_ID;
  const nonce=process.env.PATCHBOARD_QA_HTTPS_BOOT_NONCE;
  if(!expected)return invalid();
  if(!boardId)return invalid();
  if(!nonce||!/^[a-f0-9]{64}$/.test(nonce)||!uuid.test(boardId))return invalid();
  let origin:URL;
  try{origin=new URL(expected);}catch{return invalid();}
  if(origin.protocol!=="https:"||expected!==origin.origin||
    expected!==process.env.PATCHBOARD_PRIVATE_ORIGIN||origin.username||origin.password||
    origin.search||origin.hash||origin.pathname!=="/"||
    !origin.hostname||origin.hostname==="localhost"||
    origin.hostname==="127.0.0.1"||origin.hostname==="[::1]")invalid();
  // Require an entirely separate ephemeral root and a one-time proof file
  // written using mode=0600 by the dedicated local preflight launcher.
  const root=resolve(configuredRoot),prefix=join(tmpdir(),qaPrefix);
  if(!root.startsWith(prefix)||basename(root)===qaPrefix.slice(0,-1))invalid();
  let proof:unknown;
  let rootBirthMs:number|undefined;
  try{
    // macOS uses /var -> /private/var for its temp directory. Verify the
    // real PARENT is the OS temp directory, without requiring equal aliases.
    if(realpathSync(dirname(root))!==realpathSync(tmpdir())||
      lstatSync(root).isSymbolicLink())invalid();
    const rootStat=statSync(root);
    rootBirthMs=rootStat.birthtimeMs;
    function optionalEntry(path:string,directory:boolean){
      let info;
      try{info=lstatSync(path);}catch(error){
        if((error as NodeJS.ErrnoException).code==="ENOENT")return;
        throw error;
      }
      if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()))invalid();
    }
    for(const name of ["auth","jazz"])optionalEntry(join(root,name),true);
    for(const name of ["better-auth-secret","better-auth.sqlite","better-auth.sqlite-wal","better-auth.sqlite-shm"])
      optionalEntry(join(root,"auth",name),false);
    const marker=join(root,QA_HTTPS_PROFILE_PROOF_FILE);
    const markerStat=lstatSync(marker);
    if(!rootStat.isDirectory() || rootStat.mode&0o077 ||
      !markerStat.isFile() || markerStat.isSymbolicLink() ||
      markerStat.mode&0o077 || markerStat.size>1024)invalid();
    proof=JSON.parse(readFileSync(marker,"utf8")) as unknown;
  }catch{return invalid();}
  if(!proof || typeof proof!=="object" || Array.isArray(proof))invalid();
  const data=proof as Record<string,unknown>;
  const createdAtMs=data.createdAtMs;
  if(Object.keys(data).sort().join()!=="boardId,createdAtMs,format,nonce,origin" ||
    data.format!==signature || data.origin!==expected ||
    data.boardId!==boardId ||data.nonce!==nonce ||
    typeof createdAtMs!=="number"||
    !Number.isSafeInteger(createdAtMs) ||
    !rootBirthMs || Math.abs(rootBirthMs-createdAtMs)>120_000 ||
    createdAtMs>Date.now()+30_000 ||
    Date.now()-createdAtMs>30*60*1000)return invalid();
  return Object.freeze({origin:expected,boardId,root,createdAtMs});
}

/** HTTPS mode permits only the selected Owner's catalog projection.
 * All typed browser mutations and saved-view sharing remain disabled. */
export function qaHttpsCatalogBoardAllowed(boardId:string):boolean{
  const profile=qaHttpsCatalogProfile();
  return profile!==null&&profile.boardId===boardId;
}
