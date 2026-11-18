import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarBlock, daysAgo, stamp } from "./dates.js";

const now = new Date("2026-11-18T12:00:00Z"); // a Wednesday

test("stamp formats weekday and date", () => {
  assert.equal(stamp(now, "UTC"), "Wednesday 18 November 2026, 12:00");
});

test("daysAgo counts calendar days in the given tz", () => {
  assert.equal(daysAgo(new Date("2026-11-03T08:00:00Z"), now, "UTC"), 15);
  // 23:30 UTC on the 17th is already the 18th in Kolkata -> 0 days ago there
  assert.equal(daysAgo(new Date("2026-11-17T23:30:00Z"), now, "Asia/Kolkata"), 0);
});

test("calendar resolves 'last Tuesday' and 'last Wednesday'", () => {
  const c = calendarBlock(now, "UTC");
  assert.match(c, /last Tuesday = Tuesday 17 November 2026 \(yesterday\)/);
  assert.match(c, /last Wednesday = Wednesday 11 November 2026 \(7 days ago\)/);
  assert.match(c, /last Monday = Monday 16 November 2026 \(2 days ago\)/);
});
