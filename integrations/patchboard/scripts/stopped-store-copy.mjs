/** Offline-only copy of the complete private Jazz + Better Auth root.
 * The operator must fence ingress and stop every writer first. lsof is an
 * additional local check, not a distributed lock or a writer fence.
 * Use an encrypted, access-controlled backup volume for real data. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {constants,chmodSync,closeSync,copyFileSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,realpathSync,writeFileSync} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve} from "node:path";

function privateDirectory(path){
  assert(isAbsolute(path)&&resolve(path)===path,"Use a canonical absolute path");
  assert.equal(realpathSync(path),path,"No symlink ancestors");
  const info=lstatSync(path);
  assert(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,"Directory must be private");
  return path;
}
function newDestination(source,path){
  assert(isAbsolute(path)&&resolve(path)===path,"Use a canonical absolute destination");
  privateDirectory(dirname(path));
  const inside=(a,b)=>{const r=relative(a,b);return !r||(!r.startsWith("../")&&r!==".."&&!isAbsolute(r));};
  assert(!inside(source,path)&&!inside(path,source),"Source and destination must not overlap");
  // Exclusive creation: never replace an existing store or backup.
  mkdirSync(path,{mode:0o700});
  return path;
}
function stopped(path){
  const check=spawnSync("lsof",["-t","+D",path],{encoding:"utf8",timeout:30000});
  assert(!check.error&&check.status===1&&!check.stdout.trim()&&!check.stderr.trim(),"Store may be open, or lsof could not verify it; stop and inspect");
}
function digest(path){
  const fd=openSync(path,"r"),hash=createHash("sha256"),buf=Buffer.alloc(1024*1024);
  try{for(;;){const n=readSync(fd,buf,0,buf.length,null);if(!n)break;hash.update(buf.subarray(0,n));}}finally{closeSync(fd);}
  return hash.digest("hex");
}
function inventory(root){
  const entries=[];
  function walk(dir,base=""){
    for(const name of readdirSync(dir).sort()){
      const path=join(dir,name),rel=base?base+"/"+name:name,info=lstatSync(path);
      assert(!info.isSymbolicLink(),"Symlinks require a separate reviewed backup plan");
      const mode=info.mode&0o777;
      if(info.isDirectory()){entries.push({path:rel,kind:"directory",mode});walk(path,rel);}
      else{assert(info.isFile()&&info.nlink===1,"Unsupported file type or hard link");entries.push({path:rel,kind:"file",mode,bytes:info.size,sha256:digest(path)});}
    }
  }
  walk(root);
  for(const name of ["jazz/jazz.sqlite","auth/better-auth.sqlite","auth/better-auth-secret"])
    assert(entries.some(e=>e.kind==="file"&&e.path===name),"Not a complete private store");
  return entries;
}
function copy(source,target,entries){
  for(const entry of entries){
    const from=join(source,entry.path),to=join(target,entry.path);
    if(entry.kind==="directory")mkdirSync(to,{mode:0o700});
    else{copyFileSync(from,to,constants.COPYFILE_EXCL);chmodSync(to,entry.mode);}
  }
  // Apply recorded directory permissions after populating the directories.
  for(const entry of entries.toReversed())if(entry.kind==="directory")chmodSync(join(target,entry.path),entry.mode);
  assert(JSON.stringify(inventory(target))===JSON.stringify(entries),"Destination verification failed");
  assert(JSON.stringify(inventory(source))===JSON.stringify(entries),"Source changed during copy; do not use destination");
  stopped(source);
}

const [operation,sourceArg,targetArg]=process.argv.slice(2);
assert(["backup","restore"].includes(operation)&&sourceArg&&targetArg&&process.argv.length===5,
  "Usage: node scripts/stopped-store-copy.mjs backup|restore ABS_SOURCE ABS_NEW_DESTINATION");
const source=privateDirectory(sourceArg),started=performance.now();
let entries;
if(operation==="backup"){
  stopped(source);entries=inventory(source);
  const target=newDestination(source,targetArg),store=join(target,"store");
  mkdirSync(store,{mode:0o700});
  copy(source,store,entries);
  // A missing manifest marks a failed/incomplete backup. The manifest contains
  // private file metadata/checksums; keep it with the protected backup.
  writeFileSync(join(target,"manifest.json"),JSON.stringify({format:1,entries},null,2)+"\n",{flag:"wx",mode:0o600});
}else{
  const store=privateDirectory(join(source,"store"));
  stopped(store);
  const manifestPath=join(source,"manifest.json"),manifestInfo=lstatSync(manifestPath);
  assert(manifestInfo.isFile()&&!manifestInfo.isSymbolicLink()&&(manifestInfo.mode&0o077)===0,"Invalid private manifest");
  const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  assert.equal(manifest.format,1);
  entries=inventory(store);
  assert(JSON.stringify(entries)===JSON.stringify(manifest.entries),"Backup integrity verification failed");
  const target=newDestination(source,targetArg);
  copy(store,target,entries);
}
console.log("STOPPED_STORE_COPY_PASS",JSON.stringify({operation,files:entries.filter(e=>e.kind==="file").length,bytes:entries.reduce((n,e)=>n+(e.bytes??0),0),elapsedMs:Math.round(performance.now()-started)}));
