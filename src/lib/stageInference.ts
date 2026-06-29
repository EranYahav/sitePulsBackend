// Stage auto-inference for the Media Bank.
//
// At upload, we guess which construction stage a photo belongs to from its capture date
// and the project timeline. This is a PRE-FILL the supervisor confirms per batch — not the
// source of truth (capture dates are unreliable: WhatsApp/AirDrop reset them). So a 0- or
// ≥2-active result returns null and the UI asks the user to pick.
//
//   end(stage) = endDate ?? (startDate + durationWeeks*7d if duration set) ?? +∞ (open-ended)
//   active(date) = stages where startDate set AND startDate ≤ date ≤ end(stage)
//     0 active  → null   (building-level / general; allowed)
//     1 active  → that stage   (auto pre-fill)
//     ≥2 active → null   (parallel stages; user picks one of the active ones)

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StageLike {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  durationWeeks: number | null;
}

function endOf(stage: StageLike): number {
  if (stage.endDate) return stage.endDate.getTime();
  if (stage.startDate && stage.durationWeeks != null) {
    return stage.startDate.getTime() + stage.durationWeeks * 7 * DAY_MS;
  }
  return Number.POSITIVE_INFINITY; // start-only, no duration → open-ended from startDate
}

/** Stages active on `date` (startDate set and date within [startDate, end]). */
export function activeStages(stages: StageLike[], date: Date): StageLike[] {
  const t = date.getTime();
  return stages.filter(
    (s) => s.startDate != null && s.startDate.getTime() <= t && t <= endOf(s),
  );
}

/** Single best-guess stageId for a capture date, or null when 0 or ≥2 stages are active. */
export function inferStageId(stages: StageLike[], date: Date): string | null {
  const active = activeStages(stages, date);
  return active.length === 1 ? active[0]!.id : null;
}
