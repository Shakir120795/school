// Which classrooms a teacher may act on: subject assignments plus
// current class-incharge assignments. Shared by roll-call (Phase 13)
// and homework (Phase 14).
import { prisma } from "../db.js";

export async function teacherClassIds(schoolId, membershipId) {
  const profile = await prisma.teacherProfile.findFirst({
    where: { schoolId, membershipId },
    include: { classAssignments: true, inchargeAssignments: true },
  });
  if (!profile) return [];
  const ids = new Set();
  for (const a of profile.classAssignments) ids.add(a.classroomId);
  for (const i of profile.inchargeAssignments) {
    if (!i.effectiveTo || i.effectiveTo > new Date()) ids.add(i.classroomId);
  }
  return [...ids];
}
