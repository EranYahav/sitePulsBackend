import prisma from "./prisma";

const STAGE_COLORS = [
  "#6366f1", "#8b5cf6", "#0ea5e9", "#14b8a6",
  "#f59e0b", "#f43f5e", "#f97316", "#84cc16",
];

/**
 * Copy a ProjectType's stage + check templates into a Project's own Stage + Check rows.
 *
 * Mode "create" (default): initial seeding for a freshly created project.
 * Mode "reimport": additive merge — only insert templates that aren't already represented
 *   on the project (matched by templateId). Never touches existing rows.
 *
 * Wrapped in a single transaction so a failure rolls everything back.
 */
export async function seedProjectFromType(
  projectId: string,
  projectTypeId: string,
  mode: "create" | "reimport" = "create",
): Promise<{ stagesAdded: number; checksAdded: number }> {
  const type = await prisma.projectType.findUnique({
    where: { id: projectTypeId },
    include: {
      stageTemplates: {
        orderBy: { order: "asc" },
        include: { checkTemplates: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!type) {
    throw new Error(`ProjectType ${projectTypeId} not found`);
  }

  // For re-import: figure out what's already there so we skip it.
  const existingStages = mode === "reimport"
    ? await prisma.stage.findMany({
        where: { projectId, templateId: { not: null } },
        select: { id: true, templateId: true, order: true },
      })
    : [];
  const stageByTemplate = new Map(existingStages.map((s) => [s.templateId!, s]));

  let stagesAdded = 0;
  let checksAdded = 0;

  // Compute order offset so re-imported stages don't clash with user-added ones.
  const maxOrderRow = await prisma.stage.aggregate({
    where: { projectId },
    _max: { order: true },
  });
  const baseOrder = (maxOrderRow._max.order ?? -1) + 1;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < type.stageTemplates.length; i++) {
      const st = type.stageTemplates[i]!;
      let stageId: string;
      const already = stageByTemplate.get(st.id);

      if (already) {
        stageId = already.id;
      } else {
        const color = STAGE_COLORS[i % STAGE_COLORS.length]!;
        const created = await tx.stage.create({
          data: {
            projectId,
            templateId: st.id,
            title: st.title,
            description: st.description,
            color,
            durationWeeks: st.defaultDurationWeeks,
            order: mode === "create" ? i : baseOrder + i,
          },
        });
        stageId = created.id;
        stagesAdded++;
      }

      // Check templates — for re-import, only add ones not already on this stage.
      const existingChecks = mode === "reimport"
        ? await tx.check.findMany({
            where: { stageId, templateId: { not: null } },
            select: { templateId: true },
          })
        : [];
      const haveTemplate = new Set(existingChecks.map((c) => c.templateId!));

      for (let j = 0; j < st.checkTemplates.length; j++) {
        const ct = st.checkTemplates[j]!;
        if (haveTemplate.has(ct.id)) continue;

        await tx.check.create({
          data: {
            stageId,
            templateId: ct.id,
            text: ct.text,
            order: j,
          },
        });
        checksAdded++;
      }
    }
  });

  return { stagesAdded, checksAdded };
}
