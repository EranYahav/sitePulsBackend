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

const APARTMENT_IN_BUILDING: TypeSeed = {
  key: "apartment_in_building",
  nameHe: "דירה בבניין",
  nameEn: "Apartment in Building",
  description: "ליווי פנים דירה בבניין קיים (השלד נבנה ע\"י היזם)",
  order: 2,
  stages: [
    {
      title: "קבלת הדירה ובדיקת מצב מסירה",
      color: "#f59e0b",
      defaultDurationWeeks: 1,
      checks: [
        "מידות הדירה תואמות תוכנית המכר.",
        "אנכיות וישרות הקירות בטווח הסטייה המותר.",
        "מיקום פתחים, חלונות ודלתות תואם תוכנית.",
        "גובה התקרה תואם תוכנית.",
        "מישוריות הרצפה בטווח התקן.",
        "ממ״ד תקני – דלת וחלון לפי תקן הג״א.",
        "אין רטיבות או כתמי לחות בקירות ובתקרה.",
        "פתחי מעבר לצנרת ולחשמל קיימים במיקום הנכון.",
        "תועדו ליקויי בטון/גמר גלויים בקבלה.",
        "בוצע תיעוד צילומי של מצב הדירה בקבלה.",
      ],
    },
    {
      title: "מערכות גלויות – חשמל, אינסטלציה ומיזוג",
      color: "#0ea5e9",
      defaultDurationWeeks: 2,
      checks: [
        "תוואי צנרת המים תואם תוכנית.",
        "בוצעה בדיקת לחץ ואטימות לצנרת.",
        "שיפועי צנרת הביוב תקינים.",
        "מיקום נקודות החשמל לפי תוכנית.",
        "קופסאות החשמל מיוצבות ובגובה אחיד.",
        "הארקה תקינה בכל הנקודות.",
        "בוצעו הכנות למיזוג כולל ניקוז מזגן.",
        "אין הצלבה בין מים חמים לקרים.",
        "מעברי צנרת בקירות אטומים.",
        "בוצע תיעוד צילומי לפני כיסוי/טיוח.",
      ],
    },
    {
      title: "איטום אזורים רטובים",
      color: "#14b8a6",
      defaultDurationWeeks: 1,
      checks: [
        "הוכנו שיפועים לניקוז במקלחות ובמרפסת.",
        "יושמה שכבת איטום רציפה.",
        "האיטום הועלה על הקירות בגובה הנדרש.",
        "בוצעה בדיקת הצפה (48 שעות) ללא חדירה.",
        "בוצע איטום רציף סביב מעברי צנרת.",
        "חיבור האיטום למחסום הרצפה תקין.",
        "אין שלוליות או מים עומדים לאחר ייבוש.",
        "תועדה בדיקת ההצפה.",
      ],
    },
    {
      title: "ריצוף, חיפוי וגבס",
      color: "#8b5cf6",
      defaultDurationWeeks: 3,
      checks: [
        "מישוריות הריצוף בטווח הסטייה המותר.",
        "רוחב הפוגות אחיד ולפי המפרט.",
        "ריצוף ללא נקישות או חלל מתחת לאריח.",
        "חיפוי הקירות אנכי וישר.",
        "קירות הגבס אנכיים ויציבים.",
        "קיים בידוד אקוסטי/תרמי בקירות הגבס.",
        "בוצעו חיזוקים פנימיים לתליית ארונות וכלים סניטריים.",
        "פינות וקנטים מטופלים.",
        "ניקיון ומילוי פוגות תקין.",
      ],
    },
    {
      title: "מטבח, ארונות וחדרים רטובים",
      color: "#f43f5e",
      defaultDurationWeeks: 2,
      checks: [
        "חיבורי המים והביוב ללא נזילות.",
        "בוצעה אטימת סיליקון סביב כיורים, אמבט ומקלחת.",
        "אוורור תקין בחדרים הרטובים.",
        "דלתות ומגירות הארונות מיושרות.",
        "משטח העבודה מותקן ואטום.",
        "ברזים וסוללות פועלים תקין.",
        "בוצעו הכנות חשמל למטבח (תנור, כיריים, מנדף).",
        "אביזרי התלייה מעוגנים היטב.",
      ],
    },
    {
      title: "צבע, אלומיניום וגמר ומסירה",
      color: "#f97316",
      defaultDurationWeeks: 2,
      checks: [
        "צבע אחיד ללא כתמים, סימני גלילה או נזילות.",
        "חלונות אלומיניום נפתחים, נסגרים ואטומים למים ולרוח.",
        "רשתות וזיגוג תקינים.",
        "דלתות הפנים מיושרות ונועלות.",
        "אביזרי החשמל מותקנים ופועלים.",
        "בוצע ניקיון כללי לפני מסירה.",
        "הופקה רשימת ליקויים למסירה (פאנץ' ליסט).",
        "נמסרו תעודות אחריות ובדיקות.",
      ],
    },
  ],
};

const RENOVATION: TypeSeed = {
  key: "renovation",
  nameHe: "שיפוץ",
  nameEn: "Renovation",
  description: "שיפוץ דירה או בית קיים",
  order: 3,
  stages: [
    {
      title: "תכנון, היתרים והכנה",
      color: "#f59e0b",
      defaultDurationWeeks: 1,
      checks: [
        "קיים אישור או היתר לשינויים הנדרשים.",
        "זוהו הקירות הנושאים (אין להרוס ללא אישור קונסטרוקטור).",
        "בוצע תיאום עם ועד הבית והשכנים.",
        "נותקו חשמל, מים וגז באזורי העבודה.",
        "הוגנו אזורים וריהוט שנשארים.",
        "תוכננה דרך פינוי פסולת לאתר מורשה.",
        "תועד מצב לפני תחילת העבודה.",
        "התקבל אישור קונסטרוקטור לכל שינוי מבני.",
      ],
    },
    {
      title: "הריסה ופירוק",
      color: "#f43f5e",
      defaultDurationWeeks: 1,
      checks: [
        "נהרסו רק אלמנטים מאושרים.",
        "הקירות הנושאים לא נפגעו.",
        "תשתיות קיימות נחשפו ללא נזק.",
        "טופלו חומרים מסוכנים (אזבסט) אם נמצאו.",
        "בוצע ייצוב זמני במידת הצורך.",
        "אבק ורעש מבוקרים בהתאם לתקנות.",
        "הפסולת פונתה לאתר מורשה.",
        "תועד מצב לאחר ההריסה.",
      ],
    },
    {
      title: "תשתיות – חשמל, אינסטלציה ומיזוג",
      color: "#0ea5e9",
      defaultDurationWeeks: 2,
      checks: [
        "לוח החשמל עומד בעומס החדש.",
        "חיווט חדש בוצע לפי תקן.",
        "הארקה תקינה.",
        "צנרת מים ישנה הוחלפה או תוקנה לפי הצורך.",
        "בוצעה בדיקת לחץ לצנרת.",
        "שיפועי הביוב תקינים.",
        "בוצעו הכנות מיזוג וניקוז.",
        "אין חיבור בעייתי בין תשתית ישנה לחדשה.",
        "בוצע תיעוד צילומי לפני כיסוי.",
      ],
    },
    {
      title: "איטום אזורים רטובים",
      color: "#14b8a6",
      defaultDurationWeeks: 1,
      checks: [
        "הוסר איטום ישן ופגום.",
        "הוכנו שיפועים לניקוז.",
        "יושמה שכבת איטום רציפה והועלתה על הקירות.",
        "בוצעה בדיקת הצפה ללא חדירה.",
        "בוצע איטום סביב מעברי צנרת ומחסום רצפה.",
        "תועדה בדיקת ההצפה.",
      ],
    },
    {
      title: "גבס, ריצוף וחיפוי",
      color: "#8b5cf6",
      defaultDurationWeeks: 3,
      checks: [
        "קירות ותקרות הגבס אנכיים ויציבים.",
        "בוצע בידוד אקוסטי/תרמי במידת הצורך.",
        "מישוריות הריצוף בטווח התקן.",
        "ריצוף ללא חלל או נקישות.",
        "חיפוי הקירות ישר ואנכי.",
        "המעברים אל ריצוף קיים שנשאר תקינים.",
        "בוצעו חיזוקים לתליית ארונות.",
        "ניקיון ומילוי פוגות.",
      ],
    },
    {
      title: "מטבח/אמבטיה, צבע וגמר ומסירה",
      color: "#f97316",
      defaultDurationWeeks: 2,
      checks: [
        "חיבורי המים ללא נזילות.",
        "בוצעה אטימת סיליקון בחדרים רטובים.",
        "אוורור תקין.",
        "צבע אחיד ונקי.",
        "דלתות וחלונות תקינים.",
        "אביזרי החשמל פועלים.",
        "ארונות מיושרים ומעוגנים.",
        "בוצע ניקיון, נמסרו רשימת ליקויים ותעודות.",
      ],
    },
  ],
};

const COMMERCIAL: TypeSeed = {
  key: "commercial",
  nameHe: "מסחרי",
  nameEn: "Commercial",
  description: "התאמת חלל מסחרי (fit-out) כולל מערכות ורגולציה",
  order: 4,
  stages: [
    {
      title: "תכנון, תיאום ורישוי",
      color: "#f59e0b",
      defaultDurationWeeks: 2,
      checks: [
        "קיים היתר או אישור לשימוש מסחרי.",
        "קיימות תוכניות מאושרות (אדריכלות, מערכות ויועצים).",
        "בוצע תיאום עם בעל הנכס או מנהל המבנה.",
        "מופו דרישות כיבוי אש.",
        "מופו דרישות נגישות.",
        "הוגדרו אבני דרך ולוחות זמנים.",
        "הוגדרו אזורי עבודה ובטיחות באתר.",
      ],
    },
    {
      title: "מחיצות, תקרות ושלד פנים",
      color: "#6366f1",
      defaultDurationWeeks: 3,
      checks: [
        "מיקום המחיצות תואם תוכנית.",
        "מחיצות גבס או בלוק יציבות ואנכיות.",
        "בוצע בידוד אקוסטי בין יחידות או חללים.",
        "תקרות תותב או אקוסטיות מפולסות.",
        "תוכננו פתחים למערכות בתקרה.",
        "בוצעו חיזוקים לתליית ציוד כבד.",
        "עמידות אש של מחיצות במקומות הנדרשים.",
        "הגבהים תואמים תוכנית.",
      ],
    },
    {
      title: "מערכות – חשמל, מיזוג, אינסטלציה וכיבוי אש",
      color: "#0ea5e9",
      defaultDurationWeeks: 4,
      checks: [
        "לוחות החשמל לפי העומס המתוכנן.",
        "חיווט ותעלות בוצעו לפי תקן.",
        "מערכת המיזוג (HVAC) מותקנת ומפולסת.",
        "תעלות האוורור אטומות ומבודדות.",
        "מערכת מתזים או ספרינקלרים לפי תקן כיבוי.",
        "גלאי עשן ומערכת אזעקה מותקנים.",
        "צנרת מים וביוב לפי תוכנית.",
        "תאורת חירום ושילוט מילוט מותקנים.",
        "בוצע תיעוד צילומי לפני כיסוי תקרות.",
      ],
    },
    {
      title: "ריצוף, חיפוי וגמרים",
      color: "#14b8a6",
      defaultDurationWeeks: 2,
      checks: [
        "ריצוף מסחרי עמיד ומפולס.",
        "הפוגות אחידות ותקינות.",
        "חיפוי הקירות ישר.",
        "המשטחים ללא מפגעי בטיחות (החלקה או מעידה).",
        "האזורים הרטובים אטומים.",
        "גמר התקרות תקין.",
        "חומרי הגמר תואמים דרישות עמידות אש.",
      ],
    },
    {
      title: "נגישות ובטיחות",
      color: "#f43f5e",
      defaultDurationWeeks: 1,
      checks: [
        "נתיבי המילוט פנויים וברוחב תקני.",
        "שילוט חירום ונגישות במקומו.",
        "רמפות או מעלית נגישות לפי תקן.",
        "שירותי נכים תקניים.",
        "דלתות אש נסגרות אוטומטית.",
        "מטפים ועמדות כיבוי במקומם.",
        "תאורת חירום פועלת.",
        "קיים אישור יועץ נגישות.",
      ],
    },
    {
      title: "הרצת מערכות, בדיקות ומסירה",
      color: "#f97316",
      defaultDurationWeeks: 2,
      checks: [
        "בוצעה בדיקת הפעלה למערכת המיזוג.",
        "בוצעה בדיקת מערכת כיבוי האש.",
        "בוצעה בדיקת חשמל ולוחות.",
        "בוצעה בדיקת תאורת חירום.",
        "התקבל אישור כיבוי אש.",
        "התקבל אישור נגישות.",
        "נאספו תעודות בדיקה לכל המערכות.",
        "נמסרו רשימת ליקויים ותיק מתקן ללקוח.",
      ],
    },
  ],
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
