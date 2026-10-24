// School-local time helpers. All attendance windows/dates derive from the
// SCHOOL's configured timezone — never from the server's timezone.

const dtfCache = new Map();
function dtf(timeZone) {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "short",
      })
    );
  }
  return dtfCache.get(timeZone);
}

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Parts of an instant in a timezone: {dateStr:'YYYY-MM-DD', timeStr:'HH:MM', minutes, weekday:1-7} */
export function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    dtf(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    timeStr: `${hh}:${parts.minute}`,
    minutes: Number(hh) * 60 + Number(parts.minute),
    weekday: WEEKDAY[parts.weekday],
  };
}

export function hhmmToMinutes(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Evaluate a scan against an attendance policy.
 * policy: {entryStart, entryEnd, lateAfter, exitStart, exitEnd, workingWeekdays[]}
 * Returns {withinEntryWindow, isLate, withinExitWindow, isEarlyExit, isWorkingDay}
 */
export function evaluateScan(policy, eventType, parts) {
  const out = {
    isWorkingDay: !policy?.workingWeekdays?.length || policy.workingWeekdays.includes(parts.weekday),
    withinEntryWindow: false,
    isLate: false,
    withinExitWindow: false,
    isEarlyExit: false,
  };
  if (!policy) return out;
  if (eventType === "ENTRY") {
    out.withinEntryWindow =
      parts.minutes >= hhmmToMinutes(policy.entryStart) && parts.minutes <= hhmmToMinutes(policy.entryEnd);
    out.isLate = parts.minutes > hhmmToMinutes(policy.lateAfter);
  }
  if (eventType === "EXIT") {
    if (policy.exitStart && policy.exitEnd) {
      out.withinExitWindow =
        parts.minutes >= hhmmToMinutes(policy.exitStart) && parts.minutes <= hhmmToMinutes(policy.exitEnd);
      out.isEarlyExit = parts.minutes < hhmmToMinutes(policy.exitStart);
    } else {
      out.withinExitWindow = true;
    }
  }
  return out;
}

/** Date object at UTC midnight for a 'YYYY-MM-DD' local date (matches @db.Date columns). */
export function dateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
