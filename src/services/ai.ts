import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const ReportSchema = z.object({
  date: z.string(),
  projectName: z.string(),
  workersOnSite: z.number().int().min(0),
  weatherNotes: z.string(),
  workSummary: z.string(),
  issues: z.string(),
  nextDayPlan: z.string(),
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
  console.log(111, lang, langName);

  return `You are a professional construction site report writer.
Your job is to convert raw supervisor notes into a structured daily report.

CRITICAL LANGUAGE RULE: Every single text value in the JSON MUST be written in ${langName}. No exceptions. Do not use any other language for any field value, regardless of what language the input notes are in.

Formatting rules for text fields (workSummary, issues, nextDayPlan):
- Use **bold** to emphasize quantities, locations, materials, and key terms (e.g. **3 workers**, **floor 3**, **concrete pour**)
- Use bullet lists (- item) when there are multiple distinct work items or issues
- Use numbered lists (1. item) for sequential plans or ordered steps
- Keep each bullet to one line; use plain prose only when there is a single item
- weatherNotes: plain text only, no bullets
- IMPORTANT: Do NOT mention hours or time spent in workSummary, issues, or nextDayPlan — hours go only into workHourTotal and workHourDesc

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
  "date": "${today}",
  "projectName": "${projectName}",
  "workersOnSite": <integer — extract from notes, 0 if not mentioned>,
  "weatherNotes": "<weather conditions in ${langName} — extract from notes, or write 'not specified' in ${langName}>",
  "workSummary": "<detailed summary of work completed today in ${langName} — 2-4 sentences. Do NOT mention hours or time here.>",
  "issues": "<any delays, problems, or blockers in ${langName} — or write 'none reported' in ${langName}. Do NOT mention hours here.>",
  "nextDayPlan": "<planned work for tomorrow in ${langName} — extract from notes, or write 'to be determined' in ${langName}. Do NOT mention hours here.>",
  "workHourTotal": <float — total hours the supervisor was active/present. Extract from notes, 0 if not mentioned>,
  "workHourDesc": "<plain text breakdown of how the hours were spent in ${langName}, e.g. '2h drive + 3h on site + 1h client meeting'. Empty string if not mentioned.>"
}

IMPORTANT REMINDER: All text values in the JSON must be in ${langName}. Return only the JSON object. No other text.`;
}

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
