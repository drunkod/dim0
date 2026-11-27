import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,chmod,symlink} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join} from "node:path";
import {persistentTextCatalogEnabled,persistentFilteredSharingEnabled} from "../src/persistent-text-catalog.ts";

test("persistent text catalog is opt-in, HTTPS, private durable root, mutually exclusive with QA",async()=>{
  const root=await mkdtemp(join(homedir(),".dim0-catalog-profile-test-"));
  const temp=await mkdtemp(join(tmpdir(),"dim0-persistent-rejected-"));
  try{
    const env={PATCHBOARD_PERSISTENT_TEXT_CATALOG:"1",PATCHBOARD_PRIVATE_DIM0_ONLY:"1",
      PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_ORIGIN:"https://example.invalid"};
    assert.equal(persistentTextCatalogEnabled({}),false);
    assert.equal(persistentTextCatalogEnabled({...env,PATCHBOARD_PERSISTENT_TEXT_CATALOG:"0"}),false);
    assert.equal(persistentTextCatalogEnabled(env),true);
    assert.equal(persistentFilteredSharingEnabled({}),false);
    assert.equal(persistentFilteredSharingEnabled(env),false);
    const sharing={...env,PATCHBOARD_PERSISTENT_FILTERED_SHARING:"1"};
    assert.equal(persistentFilteredSharingEnabled(sharing),true);
    assert.throws(()=>persistentFilteredSharingEnabled({...sharing,PATCHBOARD_PERSISTENT_TEXT_CATALOG:"0"}),/INVALID_PERSISTENT_FILTERED_SHARING_PROFILE/);
    assert.throws(()=>persistentFilteredSharingEnabled({...sharing,PATCHBOARD_QA_TYPED_RECORD:"1"}),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
    assert.throws(()=>persistentFilteredSharingEnabled({...sharing,PATCHBOARD_PRIVATE_ROOT:temp}),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
    for(const k of ["PATCHBOARD_PRIVATE_DEV","PATCHBOARD_OAUTH_CI_RESTART","PATCHBOARD_QA_TYPED_RECORD","PATCHBOARD_QA_HTTPS_TEXT_TABLE","PATCHBOARD_ACC051_INFLIGHT_QA"])
      assert.throws(()=>persistentTextCatalogEnabled({...env,[k]:"1"}),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
    for(const change of [{PATCHBOARD_PRIVATE_ORIGIN:"http://localhost:19000"},{PATCHBOARD_PRIVATE_ORIGIN:"https://example.invalid/path"},
      {PATCHBOARD_PRIVATE_ROOT:temp},{PATCHBOARD_PRIVATE_ROOT:join(root,"missing")},{PATCHBOARD_PRIVATE_DIM0_ONLY:"0"},
      {PATCHBOARD_PRIVATE_TEST_PID_FILE:join(root,"pid")}])
      assert.throws(()=>persistentTextCatalogEnabled({...env,...change}),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
    const link=join(root,"linked");await symlink(temp,link,"dir");
    assert.throws(()=>persistentTextCatalogEnabled({...env,PATCHBOARD_PRIVATE_ROOT:link}),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
    await chmod(root,0o755);
    assert.throws(()=>persistentTextCatalogEnabled(env),/INVALID_PERSISTENT_TEXT_CATALOG_PROFILE/);
  }finally{await chmod(root,0o700);await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}
});
