import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type StageSeed = {
  title: string;
  description?: string;
  color?: string;
  defaultDurationWeeks?: number;
  checks: string[];
};

type TypeSeed = {
  key: string;
  nameHe: string;
  nameEn?: string;
  description?: string;
  order: number;
  stages: StageSeed[];
};

const PRIVATE_HOUSE: TypeSeed = {
  key: "private_house",
  nameHe: "בית פרטי",
  nameEn: "Private House",
  description: "בית פרטי על קרקע פרטית",
  order: 1,
  stages: [
    {
      title: "עבודות הכנה, מדידה וחפירה",
      color: "#f59e0b",
      defaultDurationWeeks: 2,
      checks: [
        "קיים היתר בנייה ותוכניות עבודה מעודכנות בשטח.",
        "בוצע סימון מודד מוסמך בהתאם לגרמושקה.",
        "גבולות המגרש תואמים למדידה.",
        "גובהי 0.00 סומנו ואושרו.",
        "קיימים אמצעי בטיחות וגידור אתר.",
        "בוצע פינוי פסולת וצמחייה.",
        "עומק החפירה תואם תוכנית קונסטרוקציה.",
        "תחתית החפירה יציבה וללא אדמה רכה.",
        "בוצעה הכנה לניקוז מים באתר.",
        "אין פגיעה בתשתיות קיימות.",
        "דרכי גישה למשאיות ויציקות תקינות.",
        "בוצע אישור קרקע/יועץ קרקע במידת הצורך.",
      ],
    },
    {
      title: "כלונסאות / יסודות",
      color: "#0ea5e9",
      defaultDurationWeeks: 2,
      checks: [
        "מיקום הכלונסאות תואם תוכנית.",
        "קוטר ועומק הקידוחים תואמים תוכנית.",
        "בוצע ניקוי תחתית קידוח.",
        "ברזל זיון לפי תוכנית קונסטרוקטור.",
        "כיסוי בטון תקין באמצעות ספייסרים.",
        "הכלובים קשורים ומיוצבים.",
        "בטון בדרגת חוזק מאושרת.",
        "נלקחו קוביות בטון לבדיקת מעבדה.",
        "רציפות יציקה ללא הפסקות חריגות.",
        "ראשי כלונסאות בגובה נכון.",
        "לא קיימת התמוטטות דפנות.",
        "יומן יציקות מולא כנדרש.",
      ],
    },
    {
      title: "קורות יסוד ורצפת קומת קרקע",
      color: "#14b8a6",
      defaultDurationWeeks: 3,
      checks: [
        "מידות קורות יסוד תואמות תוכנית.",
        "ברזל עליון ותחתון לפי פרט.",
        "חפיפות ברזל תקינות.",
        "כיסוי בטון תקין.",
        "הוכנסו מעברי צנרת לפני יציקה.",
        "מצע מהודק עם בדיקות הידוק.",
        "יריעות ניילון/איטום מתחת לרצפה.",
        "רשת ברזל לפי תוכנית.",
        "גובה רצפה סופי תואם תוכנית אדריכלית.",
        "בוצעו הפרדות בין בטונים במידת הצורך.",
        "בוצעה אשפרת בטון.",
        "אין סדקים חריגים לאחר יציקה.",
      ],
    },
    {
      title: "שלד – עמודים, קירות ותקרות",
      color: "#8b5cf6",
      defaultDurationWeeks: 6,
      checks: [
        "מיקום העמודים תואם תוכנית.",
        "אנכיות עמודים תקינה.",
        "ברזל זיון לפי תוכנית.",
        "פתחים ממוקמים נכון.",
        "תבניות יציבות ואטומות.",
        "גובהי תקרה נכונים.",
        "עובי תקרה תואם תוכנית.",
        "חיזוקים סביב פתחים בוצעו.",
        "צנרות חשמל ואינסטלציה הוטמנו כנדרש.",
        'לא קיימות "כוורות" בבטון.',
        "בוצעה אשפרה.",
        "פירוק תבניות לאחר הזמן הנדרש.",
        "קיים אישור קונסטרוקטור במידת הצורך.",
        "מדרגות בוצעו לפי מידות תקניות.",
      ],
    },
  ],
};

// Stubs for v2 — user can fill these in later.
const APARTMENT_IN_BUILDING: TypeSeed = {
  key: "apartment_in_building",
  nameHe: "דירה בבניין",
  nameEn: "Apartment in Building",
  order: 2,
  stages: [],
};

const RENOVATION: TypeSeed = {
  key: "renovation",
  nameHe: "שיפוץ",
  nameEn: "Renovation",
  order: 3,
  stages: [],
};

const COMMERCIAL: TypeSeed = {
  key: "commercial",
  nameHe: "מסחרי",
  nameEn: "Commercial",
  order: 4,
  stages: [],
};

const ALL_TYPES: TypeSeed[] = [PRIVATE_HOUSE, APARTMENT_IN_BUILDING, RENOVATION, COMMERCIAL];

async function seedType(seed: TypeSeed): Promise<void> {
  const type = await prisma.projectType.upsert({
    where: { key: seed.key },
    create: {
      key: seed.key,
      nameHe: seed.nameHe,
      nameEn: seed.nameEn ?? null,
      description: seed.description ?? null,
      order: seed.order,
    },
    update: {
      nameHe: seed.nameHe,
      nameEn: seed.nameEn ?? null,
      description: seed.description ?? null,
      order: seed.order,
    },
  });

  // Stages — idempotent by (projectTypeId, order).
  for (let i = 0; i < seed.stages.length; i++) {
    const s = seed.stages[i]!;
    const existing = await prisma.stageTemplate.findFirst({
      where: { projectTypeId: type.id, order: i },
    });

    const stage = existing
      ? await prisma.stageTemplate.update({
          where: { id: existing.id },
          data: {
            title: s.title,
            description: s.description ?? null,
            color: s.color ?? "#6366f1",
            defaultDurationWeeks: s.defaultDurationWeeks ?? null,
          },
        })
      : await prisma.stageTemplate.create({
          data: {
            projectTypeId: type.id,
            title: s.title,
            description: s.description ?? null,
            color: s.color ?? "#6366f1",
            defaultDurationWeeks: s.defaultDurationWeeks ?? null,
            order: i,
          },
        });

    // Checks — idempotent by (stageTemplateId, order).
    for (let j = 0; j < s.checks.length; j++) {
      const text = s.checks[j]!;
      const existingCheck = await prisma.checkTemplate.findFirst({
        where: { stageTemplateId: stage.id, order: j },
      });
      if (existingCheck) {
        await prisma.checkTemplate.update({
          where: { id: existingCheck.id },
          data: { text },
        });
      } else {
        await prisma.checkTemplate.create({
          data: { stageTemplateId: stage.id, text, order: j },
        });
      }
    }
  }

  console.log(
    `  seeded ${seed.key}: ${seed.stages.length} stages, ${seed.stages.reduce((n, s) => n + s.checks.length, 0)} checks`,
  );
}

const DEFECT_DOMAINS: Array<{ key: string; nameHe: string; nameEn: string; order: number }> = [
  // Existing keys — kept so historical defects stay valid.
  { key: "electrical",   nameHe: "חשמל",            nameEn: "Electrical",      order: 1 },
  { key: "plumbing",     nameHe: "אינסטלציה",      nameEn: "Plumbing",         order: 2 },
  { key: "drywall",      nameHe: "גבס",             nameEn: "Drywall",         order: 3 },
  { key: "tiling",       nameHe: "ריצוף",           nameEn: "Tiling",          order: 4 },
  { key: "paint",        nameHe: "צבע",             nameEn: "Paint",           order: 5 },
  { key: "structure",    nameHe: "שלד",             nameEn: "Structure",       order: 6 },
  // New construction domains.
  { key: "concrete",     nameHe: "יציקות",         nameEn: "Concrete pouring", order: 7 },
  { key: "waterproofing", nameHe: "איטום",         nameEn: "Waterproofing",    order: 8 },
  { key: "windows_doors", nameHe: "חלונות ודלתות", nameEn: "Windows & doors",  order: 9 },
  { key: "aluminum",     nameHe: "אלומיניום",      nameEn: "Aluminum",         order: 10 },
  { key: "carpentry",    nameHe: "נגרות",          nameEn: "Carpentry",        order: 11 },
  { key: "kitchen",      nameHe: "מטבח",           nameEn: "Kitchen",          order: 12 },
  { key: "landscaping",  nameHe: "גינון",          nameEn: "Landscaping",      order: 13 },
  { key: "roofing",      nameHe: "גגות",           nameEn: "Roofing",          order: 14 },
  { key: "other",        nameHe: "אחר",            nameEn: "Other",            order: 99 },
];

async function seedDefectDomains() {
  for (const d of DEFECT_DOMAINS) {
    await prisma.defectDomain.upsert({
      where: { key: d.key },
      create: { key: d.key, nameHe: d.nameHe, nameEn: d.nameEn, order: d.order },
      update: { nameHe: d.nameHe, nameEn: d.nameEn, order: d.order },
    });
  }
  console.log(`  seeded ${DEFECT_DOMAINS.length} defect domains`);
}

async function main() {
  console.log("Seeding project types…");
  for (const t of ALL_TYPES) {
    await seedType(t);
  }
  console.log("Seeding defect domains…");
  await seedDefectDomains();
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
