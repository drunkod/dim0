/** Attended operator helper: local filesystem only, never opens a route. */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {lstat,realpath,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,dirname,isAbsolute,join,resolve} from "node:path";
const root=process.env.PATCHBOARD_PRIVATE_ROOT,origin=process.env.PATCHBOARD_PRIVATE_ORIGIN,boardId=process.argv[2];
assert.ok(root&&isAbsolute(root)&&origin&&boardId);
assert.equal(root,resolve(root));
const url=new URL(origin);
assert.equal(url.origin,origin);assert.equal(url.protocol,"https:");
assert.ok(url.hostname.endsWith(".ts.net")&&!url.port,"external seal requires a dedicated canonical Tailscale HTTPS hostname");
assert.match(boardId,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
assert.ok(basename(root).startsWith("dim0-plugin-https-qa-"));
assert.equal(await realpath(dirname(root)),await realpath(tmpdir()));
const info=await lstat(root);assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077));
for(const name of ["auth","jazz"]){const item=await lstat(join(root,name));assert.ok(item.isDirectory()&&!item.isSymbolicLink());}
const createdAtMs=Math.round((await stat(root)).birthtimeMs);
assert.ok(Date.now()-createdAtMs<30*60000,"new QA root required");
const nonce=randomBytes(32).toString("hex");
const proof={format:"dim0-plugin-https-qa/v1",origin,boardId,nonce,createdAtMs};
const seal=join(root,".qa-catalog-profile.json");
await writeFile(seal,JSON.stringify(proof),{mode:0o600,flag:"wx"});
const env=["PATCHBOARD_QA_HTTPS_TEXT_TABLE=1","PATCHBOARD_QA_HTTPS_ORIGIN="+origin,"PATCHBOARD_QA_HTTPS_BOARD_ID="+boardId,"PATCHBOARD_QA_HTTPS_BOOT_NONCE="+nonce].map(v=>"export "+v).join("\n")+"\n";
await writeFile(join(root,".qa-catalog-env"),env,{mode:0o600,flag:"wx"});
console.log("HTTPS_QA_SEAL_CREATED",JSON.stringify({origin,boardId,expiresAt:new Date(createdAtMs+30*60000).toISOString()}));
