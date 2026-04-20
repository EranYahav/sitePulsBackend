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
