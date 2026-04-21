import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const ReportSchema = z.object({
  title: z.string(),
  date: z.string(),
  projectName: z.string(),
  workersOnSite: z.number().int().min(0),
  weatherNotes: z.string(),
  summary: z.string(),      // ≤50 words — key highlights only
  description: z.string(),  // comprehensive — never omit any user data
  issues: z.string(),
  nextStepsPlan: z.string(),
  workHourTotal: z.number().min(0).default(0),
  workHourDesc: z.string().default(""),
});

export type ReportData = z.infer<typeof ReportSchema>;

const LANG_NAMES: Record<string, string> = {
  en: "English",
  he: "Hebrew",
  ru: "Russian",
  ar: "Arabic",
};

const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  he: "he-IL",
  ru: "ru-RU",
  ar: "ar-SA",
};

function buildSystemPrompt(lang: string): string {
  const langName = LANG_NAMES[lang] ?? "English";

  return `You are a professional construction site report writer.
Your job is to convert raw supervisor notes into a structured daily report.

CRITICAL LANGUAGE RULE: Every single text value in the JSON MUST be written in ${langName}. No exceptions. Do not use any other language for any field value, regardless of what language the input notes are in.

Formatting rules:
- title: maximum 5 words, plain text, no punctuation, written in ${langName}
- summary: maximum 50 words, plain prose (no bullets/bold), key highlights only
- description: comprehensive account — preserve EVERY detail the supervisor mentioned, never omit anything, use **bold** for quantities/locations/materials, use bullet lists (- item) for multiple work items
- issues: use bullet lists for multiple problems; plain prose for a single issue
- nextStepsPlan: use numbered lists for sequential steps; plain prose for a single step
- weatherNotes: plain text only, no bullets
- IMPORTANT: Do NOT mention hours in summary, description, issues, or nextStepsPlan — hours go only into workHourTotal and workHourDesc

Hours extraction rules (workHourTotal, workHourDesc):
- workHourTotal: extract the total number of hours the supervisor was present/active (float, e.g. 4 or 2.5). Use 0 if not mentioned.
- workHourDesc: a plain-text breakdown of how those hours were spent (e.g. "2h drive to site and back + 3h on site + 1h meeting with client"). Write in ${langName}. Empty string if not mentioned.

Always respond with valid JSON only. No markdown code fences, no explanation — just the JSON object.`;
}

function buildPrompt(notes: string, projectName: string, lang: string): string {
  const locale = LOCALE_MAP[lang] ?? "en-GB";
  const langName = LANG_NAMES[lang] ?? "English";
  const today = new Date().toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `Convert the following construction site notes into a structured professional daily report in ${langName}.

Project: ${projectName}
Date: ${today}

Raw notes from site supervisor:
"""
${notes}
"""

Respond with a JSON object matching this exact structure:
{
  "title": "<short report title in ${langName}, max 5 words, no punctuation — summarise the main work done today>",
  "date": "${today}",
  "projectName": "${projectName}",
  "workersOnSite": <integer — extract from notes, 0 if not mentioned>,
  "weatherNotes": "<weather conditions in ${langName} — extract from notes, or write 'not specified' in ${langName}>",
  "summary": "<max 50 words, plain prose, key highlights of today's work in ${langName}. No bullets, no bold. Do NOT mention hours.>",
  "description": "<comprehensive account of ALL work done today in ${langName} — include every detail from the notes, never omit anything important. Use bullets and bold. Do NOT mention hours.>",
  "issues": "<any delays, problems, or blockers in ${langName} — or write 'none reported' in ${langName}. Do NOT mention hours here.>",
  "nextStepsPlan": "<planned work for tomorrow in ${langName} — extract from notes, or write 'to be determined' in ${langName}. Do NOT mention hours here.>",
  "workHourTotal": <float — total hours the supervisor was active/present. Extract from notes, 0 if not mentioned>,
  "workHourDesc": "<plain text breakdown of how the hours were spent in ${langName}, e.g. '2h drive + 3h on site + 1h client meeting'. Empty string if not mentioned.>"
}

IMPORTANT REMINDER: All text values in the JSON must be in ${langName}. Return only the JSON object. No other text.`;
}

// ── Defect analysis ───────────────────────────────────────────────────────────

const VALID_URGENCIES_AI = ["high", "medium", "low"] as const;
const VALID_DOMAINS_AI = ["electrical", "plumbing", "drywall", "tiling", "paint", "structure", "other"] as const;

const DefectOkSchema = z.object({
  ok: z.literal(true),
  title: z.string(),
  urgency: z.enum(VALID_URGENCIES_AI),
  domain: z.enum(VALID_DOMAINS_AI),
  description: z.string().optional(),
  tradesperson: z.string().optional(),
  reminderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const DefectErrorSchema = z.object({
  ok: z.literal(false),
  message: z.string(),
});

const DefectAnalysisSchema = z.discriminatedUnion("ok", [DefectOkSchema, DefectErrorSchema]);
export type DefectAnalysisResult = z.infer<typeof DefectAnalysisSchema>;

const DOMAIN_LABELS: Record<string, Record<string, string>> = {
  he: { electrical: "חשמל", plumbing: "אינסטלציה", drywall: "גבס", tiling: "ריצוף", paint: "צבע", structure: "שלד", other: "אחר" },
  en: { electrical: "Electrical", plumbing: "Plumbing", drywall: "Drywall", tiling: "Tiling", paint: "Paint", structure: "Structure", other: "Other" },
  ru: { electrical: "Электрика", plumbing: "Сантехника", drywall: "Гипсокартон", tiling: "Плитка", paint: "Покраска", structure: "Конструкция", other: "Другое" },
  ar: { electrical: "كهرباء", plumbing: "سباكة", drywall: "جبس", tiling: "بلاط", paint: "دهان", structure: "هيكل", other: "أخرى" },
};

const URGENCY_LABELS: Record<string, Record<string, string>> = {
  he: { high: "דחוף", medium: "בינוני", low: "נמוך" },
  en: { high: "High", medium: "Medium", low: "Low" },
  ru: { high: "Высокая", medium: "Средняя", low: "Низкая" },
  ar: { high: "عاجل", medium: "متوسط", low: "منخفض" },
};

function buildDefectSystemPrompt(lang: string): string {
  const langName = LANG_NAMES[lang] ?? "Hebrew";
  const today = new Date().toISOString().slice(0, 10);
  const dl = DOMAIN_LABELS[lang] ?? DOMAIN_LABELS.he;
  const ul = URGENCY_LABELS[lang] ?? URGENCY_LABELS.he;

  return `You are a construction site defect analyst.
Extract structured defect information from a site supervisor's verbal or written description.

Today's date: ${today}

Required fields — if you cannot determine them, return ok=false with a helpful message in ${langName}:
- title: short defect title (max 6 words, in ${langName})
- urgency: one of "high" / "medium" / "low"
  Labels: high="${ul.high}", medium="${ul.medium}", low="${ul.low}"
- domain: one of "electrical" / "plumbing" / "drywall" / "tiling" / "paint" / "structure" / "other"
  Labels: electrical="${dl.electrical}", plumbing="${dl.plumbing}", drywall="${dl.drywall}", tiling="${dl.tiling}", paint="${dl.paint}", structure="${dl.structure}", other="${dl.other}"

Optional fields — extract if mentioned:
- description: detailed defect description in ${langName}
- tradesperson: name/type of contractor responsible
- reminderDate: follow-up date as YYYY-MM-DD (parse relative dates like "in two weeks" using today's date)

If any REQUIRED field is unclear or missing, respond with:
{"ok": false, "message": "<explanation in ${langName} of what is missing and how to provide it>"}

If all required fields are present, respond with:
{"ok": true, "title": "...", "urgency": "...", "domain": "...", "description": "...", "tradesperson": "...", "reminderDate": "YYYY-MM-DD"}
Omit optional fields that were not mentioned.

Respond with valid JSON only. No markdown, no explanation.`;
}

export async function analyzeDefect(text: string, lang = "he"): Promise<DefectAnalysisResult> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: buildDefectSystemPrompt(lang),
    messages: [{ role: "user", content: text }],
  });

  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: `AI returned unexpected output. Please try again.` };
  }

  const result = DefectAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, message: `AI output format error. Please try again.` };
  }

  return result.data;
}

// ── Report generation ──────────────────────────────────────────────────────────

export async function generateAIReport(
  notes: string,
  projectName: string,
  lang = "en",
): Promise<ReportData> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: buildSystemPrompt(lang),
    messages: [
      { role: "user", content: buildPrompt(notes, projectName, lang) },
    ],
  });

  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Claude returned non-JSON output: ${raw.slice(0, 200)}`);
  }

  const result = ReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Claude output failed schema validation: ${JSON.stringify(result.error.flatten())}`,
    );
  }

  return result.data;
}
