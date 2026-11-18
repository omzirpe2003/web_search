// Date helpers. The model cannot be trusted to do calendar arithmetic ("last Tuesday"),
// so we do it in code, in the user's timezone, and hand it over as a lookup table.

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const defaultTZ = () =>
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), min: n("minute") };
}

// Calendar day number (days since epoch) of an instant *as seen in tz*.
const dayNum = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;
};

const fmtDay = (n: number) => {
  const d = new Date(n * 86_400_000);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const pad = (n: number) => String(n).padStart(2, "0");

export const daysAgo = (then: Date, now: Date, tz: string) => dayNum(now, tz) - dayNum(then, tz);

export const rel = (n: number) => (n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

/** "Monday 16 November 2026, 14:03" in tz. */
export function stamp(d: Date, tz: string) {
  const p = parts(d, tz);
  return `${fmtDay(dayNum(d, tz))}, ${pad(p.h)}:${pad(p.min)}`;
}

/** Lookup table of recent days + "most recent <weekday>" so the model never computes dates itself. */
export function calendarBlock(now: Date, tz: string, span = 28) {
  const today = dayNum(now, tz);
  const days: string[] = [];
  for (let i = 0; i < span; i++) days.push(`${fmtDay(today - i)} (${rel(i)})`);

  const last: string[] = [];
  for (let wd = 0; wd < 7; wd++) {
    for (let i = 1; i <= 7; i++) {
      if (new Date((today - i) * 86_400_000).getUTCDay() === wd) {
        last.push(`last ${WD[wd]} = ${fmtDay(today - i)} (${rel(i)})`);
        break;
      }
    }
  }
  return [
    `Now: ${stamp(now, tz)} (${tz})`,
    "",
    "Most recent occurrence of each weekday, strictly before today:",
    ...last.map((l) => `- ${l}`),
    "",
    `Last ${span} days:`,
    ...days.map((l) => `- ${l}`),
  ].join("\n");
}
