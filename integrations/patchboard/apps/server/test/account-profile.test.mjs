import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { normalizedDisplayName, normalizedAccountLocale } from
  "@patchboard/account-domain/profile";
import {
  installAccountPreferenceTables, readAccountPreferences,
  updateAccountPreferences, ProfileConflict,
} from "../src/account-adapters/profile-preferences.ts";
import { privateAccountProfileRequest } from "../src/account-adapters/profile-routes.ts";

const subjectA = randomUUID();
const subjectB = randomUUID();
const origin = "http://localhost:8947";
const path = "/patchboard-private/api/account/";
const db = new DatabaseSync(":memory:");
installAccountPreferenceTables(db);
let issuerCalls = [];
const nameIssuer = async (name, headers) => {
  issuerCalls.push({name, origin:headers.get("origin")});
  return true;
};
const req = (endpoint, body, options={}) => new Request(
  origin+path+endpoint, {
    method:body===undefined ? "GET" : "PATCH",
    ...(body===undefined ? {} : {
      headers: {
        "content-type":"application/json",
        ...(!options.withoutOrigin ? {origin} : {}),
        ...(options.origin ? {origin: options.origin} : {})
      },
      body:JSON.stringify(body),
    })
  }
);
const me = { id:subjectA, name:"Alice" };
const other = { id:subjectB, name:"Bob" };
const route = (request, user=me) =>
  privateAccountProfileRequest(request,user,db,nameIssuer);

test("real account preference store creates no synthetic email and default is read only",async()=>{
  assert.deepEqual(readAccountPreferences(db,subjectA), {locale:"en",version:0});
  const response = await route(req("profile"));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.display_name,"Alice");
  assert.equal(body.email_required,false);
  assert.equal(body.backup_passkey_enrollment_available,false);
  assert.equal(body.locale,"en");
  assert.equal(body.version,0);
  assert.ok(!("email" in body));
  assert.equal(db.prepare("SELECT count(*) AS n FROM patchboard_account_preferences").get().n,0);
});
test("locale is current-subject only with versioned receipt and exactly-once activity",async()=>{
  const command={locale:"nl-NL",expected_version:0,request_id:"idempotent-01"};
  const first=await route(req("preferences",command));
  assert.equal(first.status,200);
  assert.deepEqual(await first.json(),{locale:"nl-NL",version:1,changed:true});
  const replay=await route(req("preferences",command));
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).version,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM patchboard_account_activity").get().n,1);
  const second=await route(req("preferences"),other);
  assert.equal((await second.json()).locale,"en");
  assert.equal(readAccountPreferences(db,subjectB).version,0);
});
test("same request ID with different payload conflicts, stale version denied",async()=>{
  let result=await route(req("preferences",{
    locale:"fr",expected_version:0,request_id:"idempotent-01"
  }));
  assert.equal(result.status,409);
  assert.equal((await result.json()).error,"REQUEST_ID_CONFLICT");
  result=await route(req("preferences",{
    locale:"de",expected_version:0,request_id:"another"
  }));
  assert.equal(result.status,409);
  assert.equal((await result.json()).error,"STALE_STATE");
  assert.equal(readAccountPreferences(db,subjectA).locale,"nl-NL");
});
test("new version advances once, stale prior receipt cannot mask later state",async()=>{
  const second=await route(req("preferences",{
    locale:"de",expected_version:1,request_id:"idempotent-02"
  }));
  assert.deepEqual(await second.json(),{locale:"de",version:2,changed:true});
  const stale=await route(req("preferences",{
    locale:"nl-NL",expected_version:0,request_id:"idempotent-01"
  }));
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).error,"RECEIPT_STALE");
  assert.equal(db.prepare("SELECT count(*) AS n FROM patchboard_account_activity").get().n,2);
});
test("concurrent stale updates on one subject cannot both win",async()=>{
  const operations=await Promise.all([
    route(req("preferences",{locale:"en-GB",expected_version:2,request_id:"race-A"})),
    route(req("preferences",{locale:"it",expected_version:2,request_id:"race-B"}))
  ]);
  assert.deepEqual(operations.map(r=>r.status).sort(),[200,409]);
  assert.equal(readAccountPreferences(db,subjectA).version,3);
});
test("read and write reject identity or origin spoofing, unknown fields and malformed locale",async()=>{
  const before=readAccountPreferences(db,subjectB);
  const malicious=await route(req("preferences",{
    locale:"nl",expected_version:0,request_id:"injection",user_id:subjectB
  }));
  assert.equal(malicious.status,400);
  const wrongOrigin=await route(req("preferences",{
    locale:"nl",expected_version:0,request_id:"wrong-origin"
  },{origin:"https://evil.example"}));
  assert.equal(wrongOrigin.status,403);
  const missingOrigin=await route(req("preferences",{
    locale:"nl",expected_version:0,request_id:"absent-origin"
  },{withoutOrigin:true}));
  assert.equal(missingOrigin.status,403);
  assert.deepEqual(readAccountPreferences(db,subjectB),before);
  assert.equal((await route(req("preferences",{
    locale:"not_a_real_locale@",expected_version:3,request_id:"malformed"
  }))).status,400);
  assert.equal((await privateAccountProfileRequest(req("profile"),{id:"",name:""},db,nameIssuer)).status,401);
});
test("Better Auth display name adapter path cannot mutate via unverified body fields",async()=>{
  issuerCalls=[];
  assert.equal(normalizedDisplayName("  Dr. Ada  "), "Dr. Ada");
  assert.equal(normalizedAccountLocale("NL-nl"),"nl-NL");
  assert.throws(()=>normalizedDisplayName("\u0000Alice"),/INVALID_DISPLAY_NAME/);
  assert.throws(()=>normalizedDisplayName("  "),/INVALID_DISPLAY_NAME/);
  assert.throws(()=>normalizedAccountLocale("evil@invalid"),/INVALID_ACCOUNT_LOCALE/);
  assert.equal((await route(req("profile",{
    display_name:"  Dr. Ada  ",email:"pretend@example.com"
  }))).status,400);
  assert.equal(issuerCalls.length,0);
  const saved=await route(req("profile",{display_name:"  Dr. Ada  "}));
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).display_name,"Dr. Ada");
  assert.deepEqual(issuerCalls,[{name:"Dr. Ada",origin}]);
});
test("unknown account route does not invoke any issuer operation",async()=>{
  issuerCalls=[];
  const response=await route(req("email/send",{email:"x@example.com"}));
  assert.equal(response.status,404);
  assert.equal(issuerCalls.length,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM patchboard_account_activity").get().n,3);
});
test.after(()=>db.close());
