import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { signAccessToken } from "../src/lib/jwt";

// T6: creating a project from an OWNED (edited) property type copies that type's
// stages + checks into the project's own Stage/Check rows. Verifies the merged-catalog
// picker → seedProjectFromType path end-to-end.
describe("project creation from an owned property type", () => {
  it("copies the owned type's stages and checks into the new project", async () => {
    // A real User row is needed (Project.ownerId FK); password is unused (no login).
    const user = await prisma.user.create({
      data: { email: `t6_${Date.now()}@t.local`, password: "x", name: "T6", role: "supervisor" },
    });
    const auth = "Bearer " + signAccessToken({ sub: user.id, email: user.email, role: "supervisor" });
    const P = (url: string, body: unknown) => request(app).post(url).set("Authorization", auth).send(body);

    const type = await P("/api/v1/project-types", { nameHe: "סוג בדיקה T6" });
    const stage = await P(`/api/v1/project-types/${type.body.id}/stages`, { title: "שלב בדיקה" });
    await P(`/api/v1/project-types/${type.body.id}/stages/${stage.body.id}/checks`, { text: "בדיקת אינטגרציה" });

    expect(type.status, JSON.stringify(type.body)).toBe(201);
    const project = await P("/api/v1/projects", { name: "פרויקט T6", projectTypeId: type.body.id });
    expect(project.status, JSON.stringify(project.body)).toBe(201);

    const projectStages = await prisma.stage.findMany({ where: { projectId: project.body.id }, select: { id: true, title: true } });
    expect(projectStages.map((s) => s.title)).toContain("שלב בדיקה");
    const checks = await prisma.check.findMany({ where: { stageId: { in: projectStages.map((s) => s.id) } } });
    expect(checks.some((c) => c.text === "בדיקת אינטגרציה")).toBe(true);
  });
});
