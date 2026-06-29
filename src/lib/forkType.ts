import { Prisma, ProjectType } from "@prisma/client";
import prisma from "./prisma";
import { SYSTEM_OWNER_ID } from "./systemOwner";

/**
 * Fork-on-edit (corrected Approach A): materialize a supervisor-owned copy of ONE system
 * default property type the first time they edit it. Lazy — there is no eager provisioning.
 *
 *   system ProjectType (ownerId="__system__")
 *        │  copy subtree
 *        ▼
 *   owned ProjectType (ownerId=userId, key=<same>, originId=systemTypeId)
 *        ├── StageTemplate × n   (copied)
 *        │     └── CheckTemplate × m (copied)
 *        └── ...
 *
 * Atomic (single transaction) and idempotent: if the supervisor already owns a row with the
 * same key (because they forked it earlier, or a concurrent request just did), return that
 * row instead of creating a duplicate. The @@unique([ownerId, key]) constraint is the race
 * backstop — a losing concurrent insert throws P2002, which we catch and resolve to the
 * existing owned row.
 *
 * Kept separate from seedProjectFromType (different target schema: template tables vs a
 * project's own Stage/Check rows) — see plan-eng-review decision 3B.
 */
export async function forkType(systemTypeId: string, userId: string): Promise<ProjectType> {
  if (userId === SYSTEM_OWNER_ID) {
    throw new Error("forkType: refusing to fork into the system owner");
  }

  const system = await prisma.projectType.findUnique({
    where: { id: systemTypeId },
    include: {
      stageTemplates: {
        orderBy: { order: "asc" },
        include: { checkTemplates: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!system) throw new Error(`forkType: ProjectType ${systemTypeId} not found`);
  if (system.ownerId !== SYSTEM_OWNER_ID) {
    throw new Error("forkType: only system default types can be forked");
  }

  // Already forked? Return the existing owned row (idempotent).
  const existing = await prisma.projectType.findUnique({
    where: { ownerId_key: { ownerId: userId, key: system.key } },
  });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const owned = await tx.projectType.create({
        data: {
          ownerId: userId,
          key: system.key,
          originId: system.id,
          isHidden: false,
          nameHe: system.nameHe,
          nameEn: system.nameEn,
          description: system.description,
          order: system.order,
          isActive: system.isActive,
        },
      });

      for (const st of system.stageTemplates) {
        const stage = await tx.stageTemplate.create({
          data: {
            projectTypeId: owned.id,
            title: st.title,
            description: st.description,
            color: st.color,
            defaultDurationWeeks: st.defaultDurationWeeks,
            order: st.order,
          },
        });
        if (st.checkTemplates.length > 0) {
          await tx.checkTemplate.createMany({
            data: st.checkTemplates.map((ct) => ({
              stageTemplateId: stage.id,
              text: ct.text,
              order: ct.order,
              isRequired: ct.isRequired,
            })),
          });
        }
      }

      return owned;
    });
  } catch (e) {
    // Concurrent fork won the race — resolve to the row it created.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await prisma.projectType.findUnique({
        where: { ownerId_key: { ownerId: userId, key: system.key } },
      });
      if (raced) return raced;
    }
    throw e;
  }
}
