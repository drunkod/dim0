import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

test("typed QA requires three flags, HTTP loopback and disposable root",async()=>{
  const root=await mkdtemp(join(tmpdir(),"patchboard-private-ci-gate-"));
  const outside=await mkdtemp(join(tmpdir(),"patchboard-typed-gate-outside-"));
  try{
    const env={...process.env,PATCHBOARD_QA_TYPED_RECORD:"1",PATCHBOARD_PRIVATE_DEV:"1",
      PATCHBOARD_OAUTH_CI_RESTART:"1",PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_ORIGIN:"http://127.0.0.1:19191"};
    const module=pathToFileURL(join(process.cwd(),"src/typed-record-qa-gate.ts")).href;
    const probe=(changes,expected)=>{
      const result=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",
        `import {typedRecordQaEnabled} from "${module}"; console.log(typedRecordQaEnabled());`],
        {env:{...env,...changes},encoding:"utf8"});
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.trim(),String(expected));
    };
    probe({},true);
    for(const flag of ["PATCHBOARD_QA_TYPED_RECORD","PATCHBOARD_PRIVATE_DEV","PATCHBOARD_OAUTH_CI_RESTART"])probe({[flag]:"0"},false);
    probe({PATCHBOARD_PRIVATE_ROOT:outside},false);
    const link=join(root,"patchboard-private-ci-linked");
    await symlink(outside,link,"dir");
    probe({PATCHBOARD_PRIVATE_ROOT:link},false);
    probe({PATCHBOARD_PRIVATE_ORIGIN:"https://example.invalid"},false);
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
