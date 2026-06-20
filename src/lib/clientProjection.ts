import prisma from "./prisma";

// Allowlist-by-construction client projection. Only the fields named here ever
// reach the public portal — a new column on Stage/Defect/Report can NEVER leak by
// default, because this serializer copies named fields, it does not spread rows.
// Both the public portal route and the inspector "View as Client" preview call this
// single function, so the two paths can never drift.

const MAX_MILESTONE_PHOTOS = 3;

function proxyUrl(token: string, cloudinaryId: string | null): string | null {
  if (!cloudinaryId) return null;
  return `/api/v1/portal/${token}/image/${encodeURIComponent(cloudinaryId)}`;
}

export interface ClientPortalDTO {
  brand: { companyName: string | null; logoUrl: string | null };
  overview: {
    projectName: string;
    description: string;
    currentStage: string | null;
    progressPct: number;
    latestUpdate: string | null;
  };
  milestones: Array<{
    id: string;
    title: string;
    description: string | null;
    completedAt: string;
    photos: string[];
  }>;
  activity: {
    defectsIdentified: number;
    defectsResolved: number;
    defectsOpen: number;
    reportsPublished: number;
    milestonesCompleted: number;
  };
  defects: Array<{
    id: string;
    title: string;
    status: string;
    beforeUrl: string | null;
    afterUrl: string | null;
  }>;
}

export async function buildClientPortal(projectId: string, token: string): Promise<ClientPortalDTO | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { owner: true },
  });
  if (!project) return null;

  const [stages, publishedReports, defects] = await Promise.all([
    prisma.stage.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    prisma.report.findMany({ where: { projectId, clientPublished: true }, include: { images: true } }),
    prisma.defect.findMany({ where: { projectId } }),
  ]);

  // Published completed milestones only (A1: completed-milestones-only feed; E1: publish gate)
  const publishedMilestones = stages
    .filter((s) => s.completedAt && s.clientPublished)
    .sort((a, b) => (b.completedAt!.getTime() - a.completedAt!.getTime()));

  // Progress %: published-completed stages / total stages, aligned with what the
  // client actually sees. (Equal-weight for now — duration weighting is TODO T2.)
  const totalStages = stages.length;
  const progressPct = totalStages === 0
    ? 0
    : Math.round((publishedMilestones.length / totalStages) * 100);

  // Current stage = first not-yet-completed stage in order
  const currentStage = stages.find((s) => !s.completedAt)?.title ?? null;

  // Milestone photos: images from this stage's published reports
  const reportsByStage = new Map<string, typeof publishedReports>();
  for (const r of publishedReports) {
    if (!r.stageId) continue;
    const arr = reportsByStage.get(r.stageId) ?? [];
    arr.push(r);
    reportsByStage.set(r.stageId, arr);
  }

  const milestones = publishedMilestones.map((s) => {
    const photos: string[] = [];
    for (const r of reportsByStage.get(s.id) ?? []) {
      for (const img of r.images) {
        const u = proxyUrl(token, img.cloudinaryId);
        if (u && photos.length < MAX_MILESTONE_PHOTOS) photos.push(u);
      }
    }
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      completedAt: s.completedAt!.toISOString(),
      photos,
    };
  });

  // Latest update across published content
  const dates: number[] = [
    ...publishedMilestones.map((s) => s.completedAt!.getTime()),
    ...publishedReports.map((r) => r.createdAt.getTime()),
  ];
  const latestUpdate = dates.length ? new Date(Math.max(...dates)).toISOString() : null;

  // Aggregate activity counts use ALL defects (proof-of-work totals), while the
  // defect LIST below shows only client-visible ones.
  const defectsResolved = defects.filter((d) => d.status === "resolved").length;
  const activity = {
    defectsIdentified: defects.length,
    defectsResolved,
    defectsOpen: defects.length - defectsResolved,
    reportsPublished: publishedReports.length,
    milestonesCompleted: publishedMilestones.length,
  };

  const clientDefects = defects
    .filter((d) => d.clientVisible)
    .map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      beforeUrl: proxyUrl(token, d.cloudinaryId),
      afterUrl: proxyUrl(token, d.resolvedCloudinaryId),
    }));

  return {
    brand: {
      companyName: project.owner.companyName,
      logoUrl: proxyUrl(token, project.owner.companyLogoCloudinaryId),
    },
    overview: {
      projectName: project.name,
      description: project.description,
      currentStage,
      progressPct,
      latestUpdate,
    },
    milestones,
    activity,
    defects: clientDefects,
  };
}

// The set of Cloudinary IDs the portal is allowed to proxy for this project.
// The image proxy checks membership so the proxy can't be used to fetch arbitrary
// assets — only images attached to client-visible items.
export async function allowedImageIds(projectId: string): Promise<Set<string>> {
  const [project, publishedReports, visibleDefects] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, include: { owner: true } }),
    prisma.report.findMany({ where: { projectId, clientPublished: true }, include: { images: true } }),
    prisma.defect.findMany({ where: { projectId, clientVisible: true } }),
  ]);

  const ids = new Set<string>();
  if (project?.owner.companyLogoCloudinaryId) ids.add(project.owner.companyLogoCloudinaryId);
  for (const r of publishedReports) for (const img of r.images) ids.add(img.cloudinaryId);
  for (const d of visibleDefects) {
    if (d.cloudinaryId) ids.add(d.cloudinaryId);
    if (d.resolvedCloudinaryId) ids.add(d.resolvedCloudinaryId);
  }
  return ids;
}
