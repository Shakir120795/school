// Phase 22: unique role login links + parent ID/password mode.
// - GET /auth/config reports the parent login mode (default password;
//   PARENT_AUTH_MODE=otp switches back to mobile OTP — server-side only).
// - A PARENT login created by the school with the guardian's mobile
//   links the guardian record, so password login immediately shows
//   the children (the same link the OTP flow creates automatically).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startServer, req, bootstrapSchool, uniqueEmail } from "./harness.js";

let base, ctx;

before(async () => {
  base = await startServer();
  ctx = await bootstrapSchool(base, "p22");
});

test("auth config defaults to parent password mode", async () => {
  const r = await req(base, "GET", "/auth/config");
  assert.equal(r.status, 200);
  assert.equal(r.json.parentAuthMode, "password");
});

test("parent created with guardianPhone links the guardian: password login sees children", async () => {
  const student = await ctx.makeStudentWithGuardian();
  const parentEmail = uniqueEmail("p22parent");
  const create = await req(base, "POST", `/schools/${ctx.schoolId}/users`, {
    token: ctx.adminToken,
    body: { email: parentEmail, fullName: "Linked Parent", password: "ParentPass1!", role: "PARENT", guardianPhone: "9999999999" },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.guardiansLinked, 1);

  const login = await req(base, "POST", "/auth/login", { body: { email: parentEmail, password: "ParentPass1!" } });
  assert.equal(login.status, 200);
  const children = await req(base, "GET", `/schools/${ctx.schoolId}/my-children`, { token: login.json.accessToken });
  assert.equal(children.status, 200);
  assert.ok(children.json.children.some((c) => c.id === student.id), "linked parent must see the child");
});

test("parent created without guardianPhone links nothing but can still log in", async () => {
  const parentEmail = uniqueEmail("p22orphan");
  const create = await req(base, "POST", `/schools/${ctx.schoolId}/users`, {
    token: ctx.adminToken,
    body: { email: parentEmail, fullName: "Unlinked Parent", password: "ParentPass1!", role: "PARENT" },
  });
  assert.equal(create.status, 201);
  assert.equal(create.json.guardiansLinked, 0);
  const login = await req(base, "POST", "/auth/login", { body: { email: parentEmail, password: "ParentPass1!" } });
  assert.equal(login.status, 200);
  const children = await req(base, "GET", `/schools/${ctx.schoolId}/my-children`, { token: login.json.accessToken });
  assert.deepEqual(children.json.children, []);
});
