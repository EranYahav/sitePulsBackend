import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { signAccessToken } from "../src/lib/jwt";

const tok = (sub: string, role = "supervisor") =>
  "Bearer " + signAccessToken({ sub, email: `${sub}@t.local`, role });

const A = tok("userA");
const B = tok("userB");
const MGR = tok("mgr", "manager");

const get = (auth: string, url = "/api/v1/project-types") => request(app).get(url).set("Authorization", auth);
const post = (auth: string, url: string, body?: unknown) => request(app).post(url).set("Authorization", auth).send(body ?? {});
const patch = (auth: string, url: string, body: unknown) => request(app).patch(url).set("Authorization", auth).send(body);
const del = (auth: string, url: string) => request(app).delete(url).set("Authorization", auth);

// Wipe only THIS file's owners between tests (never system rows, never other files' rows —
// test files share one test.db and may interleave).
beforeEach(async () => {
  await prisma.projectType.deleteMany({ where: { ownerId: { in: ["userA", "userB", "mgr"] } } });
});

async function aSystemType() {
  const r = await get(A);
  const sys = r.body.find((t: { isSystem: boolean }) => t.isSystem);
  return sys as { id: string; key: string; nameHe: string; stageCount: number };
}

describe("project-types: merged catalog + isolation", () => {
  it("a fresh supervisor sees the 4 system defaults, no owned", async () => {
    const r = await get(A);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(4);
    expect(r.body.every((t: { isSystem: boolean }) => t.isSystem)).toBe(true);
  });

  it("a new owned type is visible to its owner only (isolation)", async () => {
    const created = await post(A, "/api/v1/project-types", { nameHe: "מחסן" });
    expect(created.status).toBe(201);
    const a = await get(A);
    expect(a.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const b = await get(B);
    expect(b.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
    expect(b.body.length).toBe(4); // B still just the defaults
  });
});

describe("project-types: fork-on-edit", () => {
  it("forks a system default into an owned copy, idempotently", async () => {
    const sys = await aSystemType();
    const f1 = await post(A, `/api/v1/project-types/${sys.id}/fork`);
    expect(f1.status).toBe(201);
    expect(f1.body.key).toBe(sys.key);
    expect(f1.body.ownerId).toBe("userA");
    expect(f1.body.originId).toBe(sys.id);
    // subtree copied
    const tmpl = await get(A, `/api/v1/project-types/${f1.body.id}/templates`);
    expect(tmpl.body.stageTemplates.length).toBe(sys.stageCount);
    // second fork returns the same owned row (idempotent)
    const f2 = await post(A, `/api/v1/project-types/${sys.id}/fork`);
    expect(f2.body.id).toBe(f1.body.id);
  });

  it("editing a forked type does not affect another supervisor", async () => {
    const sys = await aSystemType();
    const f = await post(A, `/api/v1/project-types/${sys.id}/fork`);
    await patch(A, `/api/v1/project-types/${f.body.id}`, { nameHe: "שם ערוך" });
    const a = await get(A);
    const aRow = a.body.find((t: { key: string }) => t.key === sys.key);
    expect(aRow.nameHe).toBe("שם ערוך");
    expect(aRow.isSystem).toBe(false);
    const b = await get(B);
    const bRow = b.body.find((t: { key: string }) => t.key === sys.key);
    expect(bRow.nameHe).toBe(sys.nameHe); // B still sees the original system text
    expect(bRow.isSystem).toBe(true);
  });

  it("mutating a system type's stages requires forking first (409)", async () => {
    const sys = await aSystemType();
    const r = await post(A, `/api/v1/project-types/${sys.id}/stages`, { title: "x" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_FORK");
  });
});

describe("project-types: IDOR / authorization", () => {
  it("a supervisor cannot edit or delete another's type / stage / check", async () => {
    const created = await post(A, "/api/v1/project-types", { nameHe: "של A" });
    const typeId = created.body.id;
    const stage = await post(A, `/api/v1/project-types/${typeId}/stages`, { title: "שלב" });
    const stageId = stage.body.id;
    const check = await post(A, `/api/v1/project-types/${typeId}/stages/${stageId}/checks`, { text: "בדיקה" });
    const checkId = check.body.id;

    expect((await patch(B, `/api/v1/project-types/${typeId}`, { nameHe: "פריצה" })).status).toBe(404);
    expect((await del(B, `/api/v1/project-types/${typeId}`)).status).toBe(404);
    expect((await patch(B, `/api/v1/project-types/${typeId}/stages/${stageId}`, { title: "פריצה" })).status).toBe(404);
    expect((await del(B, `/api/v1/project-types/${typeId}/stages/${stageId}`)).status).toBe(404);
    expect((await patch(B, `/api/v1/project-types/${typeId}/stages/${stageId}/checks/${checkId}`, { text: "פריצה" })).status).toBe(404);
    expect((await del(B, `/api/v1/project-types/${typeId}/stages/${stageId}/checks/${checkId}`)).status).toBe(404);

    // and A's data is untouched
    const tmpl = await get(A, `/api/v1/project-types/${typeId}/templates`);
    expect(tmpl.body.nameHe).toBe("של A");
    expect(tmpl.body.stageTemplates[0].checkTemplates[0].text).toBe("בדיקה");
  });
});

describe("project-types: delete / tombstone", () => {
  it("deleting a system default tombstones it for that supervisor only", async () => {
    const sys = await aSystemType();
    const r = await del(A, `/api/v1/project-types/${sys.id}`);
    expect(r.status).toBe(200);
    const a = await get(A);
    expect(a.body.some((t: { key: string }) => t.key === sys.key)).toBe(false); // hidden for A
    const b = await get(B);
    expect(b.body.some((t: { key: string }) => t.key === sys.key)).toBe(true); // intact for B
  });

  it("deleting an owned new type really removes it", async () => {
    const created = await post(A, "/api/v1/project-types", { nameHe: "זמני" });
    const r = await del(A, `/api/v1/project-types/${created.body.id}`);
    expect(r.status).toBe(200);
    const a = await get(A);
    expect(a.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
  });
});

describe("project-types: manager + caps", () => {
  it("a manager gets read-only system defaults and cannot create", async () => {
    const r = await get(MGR);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(4);
    expect(r.body.every((t: { isSystem: boolean }) => t.isSystem)).toBe(true);
    expect((await post(MGR, "/api/v1/project-types", { nameHe: "x" })).status).toBe(403);
  });

  it("enforces MAX_STAGES on a type", async () => {
    const created = await post(A, "/api/v1/project-types", { nameHe: "גדול" });
    const id = created.body.id;
    for (let i = 0; i < 20; i++) {
      const ok = await post(A, `/api/v1/project-types/${id}/stages`, { title: `s${i}` });
      expect(ok.status).toBe(201);
    }
    const over = await post(A, `/api/v1/project-types/${id}/stages`, { title: "21" });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("STAGE_LIMIT");
  });
});
