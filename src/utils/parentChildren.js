// Batched "which children does this parent login have" lookup, shared
// by BOTH member-list endpoints (platform console drill-in in
// platform.js + school Team page list in schools.js) so parent rows
// can show child-name + class chips instead of only a count.
// Three queries total for ANY number of parents — guardians, then the
// student-guardian links with student + classroom included — never a
// per-parent loop, so it stays cheap at ~1000 parents per school.
import { prisma } from "../db.js";

// The class label used across the app: classroom name + "-" + section
// when a section exists ("1-A"); just the name otherwise.
export function classLabel(classroom) {
  if (!classroom) return "";
  return `${classroom.name}${classroom.section ? "-" + classroom.section : ""}`;
}

// Returns { [userId]: [{ name, classLabel }] } for the given PARENT
// user ids within one school. Parents with no linked children are
// simply absent from the map. A child linked to the same login via
// two guardian records is listed once.
export async function childrenByParentUser(schoolId, parentUserIds) {
  const out = {};
  if (!parentUserIds.length) return out;
  const guardians = await prisma.guardian.findMany({
    where: { schoolId, userId: { in: parentUserIds } },
    select: { id: true, userId: true },
  });
  if (!guardians.length) return out;
  const userByGuardian = Object.fromEntries(guardians.map((g) => [g.id, g.userId]));
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
    select: {
      guardianId: true,
      student: {
        select: {
          id: true,
          fullName: true,
          classroom: { select: { name: true, section: true } },
        },
      },
    },
  });
  const seen = new Set();
  for (const l of links) {
    const userId = userByGuardian[l.guardianId];
    if (!userId || !l.student) continue;
    const dedupeKey = `${userId}|${l.student.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    (out[userId] ||= []).push({ name: l.student.fullName, classLabel: classLabel(l.student.classroom) });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
