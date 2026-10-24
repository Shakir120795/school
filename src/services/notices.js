// Notice audience resolution + send permissions (blueprint §7).
// Teachers: assigned classes / students of assigned classes ONLY.
// Principal & school admin: every audience, including school-wide broadcasts.
import { prisma } from "../db.js";

const BROADCAST = ["ALL_PARENTS", "ALL_TEACHERS", "ALL_PARENTS_AND_TEACHERS", "SELECTED_GUARDIANS", "INDIVIDUAL_STAFF"];

export async function teacherClassIds(schoolId, membershipId) {
  const profile = await prisma.teacherProfile.findUnique({
    where: { membershipId },
    include: {
      classAssignments: { select: { classroomId: true } },
      inchargeAssignments: { where: { effectiveTo: null }, select: { classroomId: true } },
    },
  });
  if (!profile) return { teacherId: null, classIds: [] };
  const ids = new Set([
    ...profile.classAssignments.map((a) => a.classroomId),
    ...profile.inchargeAssignments.map((a) => a.classroomId),
  ]);
  return { teacherId: profile.id, classIds: [...ids] };
}

/** Returns {ok:true} or {ok:false, error} for a sender attempting this audience. */
export async function checkNoticePermission(schoolId, membership, audienceType, targets, audienceMeta) {
  if (!membership) return { ok: false, error: "NO_MEMBERSHIP" };
  if (["PRINCIPAL", "SCHOOL_ADMIN"].includes(membership.role)) return { ok: true };
  if (membership.role !== "TEACHER") return { ok: false, error: "ROLE_CANNOT_SEND_NOTICES" };
  if (BROADCAST.includes(audienceType)) return { ok: false, error: "TEACHER_BROADCAST_FORBIDDEN" };

  const { classIds } = await teacherClassIds(schoolId, membership.id);
  if (audienceType === "ASSIGNED_CLASS") {
    const wanted = (targets || []).map((t) => t.classroomId).filter(Boolean);
    if (!wanted.length) return { ok: false, error: "NO_CLASS_TARGET" };
    if (!wanted.every((id) => classIds.includes(id))) return { ok: false, error: "CLASS_NOT_ASSIGNED" };
    return { ok: true };
  }
  if (audienceType === "SELECTED_STUDENTS") {
    const studentIds = (targets || []).map((t) => t.studentId).filter(Boolean);
    if (!studentIds.length) return { ok: false, error: "NO_STUDENT_TARGET" };
    const students = await prisma.student.findMany({
      where: { schoolId, id: { in: studentIds } },
      select: { id: true, classroomId: true },
    });
    if (students.length !== studentIds.length) return { ok: false, error: "STUDENT_NOT_IN_SCHOOL" };
    if (!students.every((s) => s.classroomId && classIds.includes(s.classroomId)))
      return { ok: false, error: "STUDENT_NOT_IN_ASSIGNED_CLASS" };
    return { ok: true };
  }
  return { ok: false, error: "UNSUPPORTED_AUDIENCE_FOR_TEACHER" };
}

async function guardiansOfStudents(schoolId, studentIds) {
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, studentId: { in: studentIds } },
    select: { guardianId: true },
  });
  return [...new Set(links.map((l) => l.guardianId))];
}

/**
 * Resolve an audience to a recipient snapshot list:
 * [{ recipientType: 'GUARDIAN'|'TEACHER'|'STAFF', recipientRef }]
 */
export async function resolveAudience(schoolId, audienceType, targets, audienceMeta) {
  const guardians = new Set();
  const staff = []; // {type, ref}

  if (audienceType === "ASSIGNED_CLASS") {
    const classIds = targets.map((t) => t.classroomId).filter(Boolean);
    const students = await prisma.student.findMany({
      where: { schoolId, classroomId: { in: classIds }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const gid of await guardiansOfStudents(schoolId, students.map((s) => s.id))) guardians.add(gid);
  } else if (audienceType === "SELECTED_STUDENTS") {
    const studentIds = targets.map((t) => t.studentId).filter(Boolean);
    for (const gid of await guardiansOfStudents(schoolId, studentIds)) guardians.add(gid);
  } else if (audienceType === "SELECTED_GUARDIANS") {
    for (const t of targets) if (t.guardianId) guardians.add(t.guardianId);
  } else if (audienceType === "ALL_PARENTS" || audienceType === "ALL_PARENTS_AND_TEACHERS") {
    const all = await prisma.guardian.findMany({ where: { schoolId, status: "ACTIVE" }, select: { id: true } });
    for (const g of all) guardians.add(g.id);
  }
  if (audienceType === "ALL_TEACHERS" || audienceType === "ALL_PARENTS_AND_TEACHERS") {
    const teachers = await prisma.schoolMembership.findMany({
      where: { schoolId, role: "TEACHER", status: "ACTIVE" },
      select: { id: true },
    });
    for (const m of teachers) staff.push({ recipientType: "TEACHER", recipientRef: m.id });
  }
  if (audienceType === "INDIVIDUAL_STAFF") {
    for (const mid of audienceMeta?.staffMembershipIds || []) {
      const m = await prisma.schoolMembership.findFirst({ where: { id: mid, schoolId, status: "ACTIVE" } });
      if (m) staff.push({ recipientType: "STAFF", recipientRef: m.id });
    }
  }
  return [
    ...[...guardians].map((gid) => ({ recipientType: "GUARDIAN", recipientRef: gid })),
    ...staff,
  ];
}

/**
 * Core send: snapshot recipients + write the outbox event + flip the notice
 * to SENDING, all in ONE transaction. Permission checks live in the route
 * (API) — the worker calls this directly for scheduled notices.
 * Returns the recipient count, or null when the notice cannot be sent.
 */
export async function sendNoticeCore(schoolId, notice) {
  const recipients = await resolveAudience(schoolId, notice.audienceType, notice.targets || [], notice.audienceMeta);
  const result = await prisma.$transaction(async (tx) => {
    if (recipients.length) {
      await tx.noticeRecipient.createMany({
        data: recipients.map((r) => ({
          schoolId,
          noticeId: notice.id,
          recipientType: r.recipientType,
          recipientRef: r.recipientRef,
        })),
        skipDuplicates: true,
      });
    }
    const updated = await tx.notice.update({
      where: { id: notice.id },
      data: { status: "SENDING", sentAt: new Date() },
    });
    await tx.notificationOutbox.create({
      data: {
        schoolId,
        eventType: "notice.send",
        aggregateType: "Notice",
        aggregateId: notice.id,
        payload: { noticeId: notice.id, recipientCount: recipients.length },
        idempotencyKey: `notice:${notice.id}:send`,
      },
    });
    return updated;
  });
  return { notice: result, recipientCount: recipients.length };
}
