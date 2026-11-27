import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {homedir} from "node:os";
import {join,resolve} from "node:path";
import {test} from "node:test";

const workspace=resolve(import.meta.dirname,"../../.."),serverDir=join(workspace,"apps/server");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function deadline(promise,ms){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Graceful stop deadline")),ms);})])
    .finally(()=>clearTimeout(timer));
}
function port(){
  return new Promise((yes,no)=>{
    const listener=createServer().once("error",no);
    listener.listen(0,"127.0.0.1",()=>{const p=listener.address().port;listener.close(()=>yes(p));});
  });
}

test("beta.5 private daemon keeps signal listeners until HTTP and auth close",{timeout:90000},async()=>{
  const root=await mkdtemp(join(homedir(),".dim0-private-stop-"));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PATCHBOARD_|DIM0_|VITE_|JAZZ_|BETTER_AUTH_|DATABASE_URL$|APP_PORT$|PORT$)/.test(k)));
  const p=await port();
  Object.assign(env,{PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_ORIGIN:"https://restore.localhost",PATCHBOARD_PRIVATE_PORT:String(p),
    PATCHBOARD_PRIVATE_DIM0_ONLY:"1",PATCHBOARD_PERSISTENT_TEXT_CATALOG:"1",PATCHBOARD_PERSISTENT_FILTERED_SHARING:"1",PATCHBOARD_PERSISTENT_MCP_TABLE_CREATE:"1"});
  let child;
  try{
    execFileSync("pnpm",["auth:migrate:private"],{cwd:workspace,env,stdio:"pipe",timeout:45000});
    for(const signal of ["SIGTERM","SIGINT"]){
      child=spawn(process.execPath,["--import","tsx","src/private-demo.ts"],{cwd:serverDir,env,stdio:["ignore","pipe","pipe"]});
      let stdout="";
      child.stdout.on("data",chunk=>{stdout+=String(chunk);});
      child.stderr.resume();
      const done=new Promise((yes,no)=>{child.once("error",no);child.once("close",(code,signal)=>yes({code,signal}));});
      let ready=false;
      for(let i=0;i<120;i++){
        assert.equal(child.exitCode,null,"Daemon exited before readiness");
        try{
          const r=await fetch("http://127.0.0.1:"+p+"/health",{signal:AbortSignal.timeout(1000)});
          if(r.ok&&stdout.includes("PRIVATE_AUTH_READY")){await r.text();ready=true;break;}
        }catch{}
        await delay(250);
      }
      assert(ready,"Private daemon did not become ready");
      assert(child.kill(signal));
      // Both signals must return a clean exit, not the SDK's re-raised signal.
      assert.deepEqual(await deadline(done,20000),{code:0,signal:null});
      assert.equal(stdout.split("\n").filter(x=>x==="PRIVATE_AUTH_STOPPED").length,1);
    }
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){
      child.kill("SIGKILL");
      await new Promise(resolve=>child.once("close",resolve));
    }
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
