// Platform operator console API (Phase 21).
// The operator (shakir) sits ABOVE all schools: list every school
// with live counts, create schools (POST /schools in schools.js),
// suspend/reactivate a school, reset a school admin's password, and
// permanently delete a school with all of its data.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { hashPassword } from "../utils/security.js";

const router = Router();

function requirePlatform(req, res, next) {
  if (!req.user?.isPlatformAdmin) return res.status(403).json({ error: "PLATFORM_ADMIN_ONLY" });
  return next();
}
router.use("/platform", requireAuth, requirePlatform);

async function revokeSessions(userId) {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

router.get("/platform/schools", asyncRoute(async (req, res) => {
  const schools = await prisma.school.findMany({ orderBy: { createdAt: "asc" } });
  const out = [];
  for (const s of schools) {
    const [students, teachers, classes, parents] = await Promise.all([
      prisma.student.count({ where: { schoolId: s.id, status: "ACTIVE" } }),
      prisma.schoolMembership.count({ where: { schoolId: s.id, role: "TEACHER", status: "ACTIVE" } }),
      prisma.classroom.count({ where: { schoolId: s.id } }),
      prisma.schoolMembership.count({ where: { schoolId: s.id, role: "PARENT", status: "ACTIVE" } }),
    ]);
    const admin = await prisma.schoolMembership.findFirst({
      where: { schoolId: s.id, role: "SCHOOL_ADMIN" },
      include: { user: { select: { email: true, fullName: true } } },
    });
    out.push({
      id: s.id, name: s.name, slug: s.slug, status: s.status, timezone: s.timezone,
      createdAt: s.createdAt, students, teachers, classes, parents,
      adminEmail: admin?.user.email || null, adminName: admin?.user.fullName || null,
    });
  }
  return res.json({ schools: out });
}));

router.patch("/platform/schools/:schoolId/status", asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!["ACTIVE", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
  const school = await prisma.school.findUnique({ where: { id: req.params.schoolId } });
  if (!school) return res.status(404).json({ error: "NOT_FOUND" });
  const updated = await prisma.school.update({ where: { id: school.id }, data: { status } });
  return res.json({ school: { id: updated.id, status: updated.status } });
}));

router.post("/platform/schools/:schoolId/reset-admin-password", asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["newPassword"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
  const admin = await prisma.schoolMembership.findFirst({
    where: { schoolId: req.params.schoolId, role: "SCHOOL_ADMIN" },
  });
  if (!admin) return res.status(404).json({ error: "SCHOOL_ADMIN_NOT_FOUND" });
  await prisma.user.update({
    where: { id: admin.userId },
    data: { passwordHash: await hashPassword(req.body.newPassword) },
  });
  await revokeSessions(admin.userId);
  return res.json({ reset: true });
}));

// Phase 23 drill-in: every member of one school, grouped by role.
// The operator controls everyone — school admins, teachers, staff
// and parents — without needing a login inside the school.
router.get("/platform/schools/:schoolId/members", asyncRoute(async (req, res) => {
  const school = await prisma.school.findUnique({
    where: { id: req.params.schoolId },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!school) return res.status(404).json({ error: "NOT_FOUND" });
  const memberships = await prisma.schoolMembership.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Parents: how many children each parent login is linked to
  // (Guardian.userId -> StudentGuardian rows). Both lookups are
  // resolved up front; no transaction is involved.
  const parentUserIds = memberships.filter((m) => m.role === "PARENT").map((m) => m.userId);
  const childrenByUser = {};
  if (parentUserIds.length) {
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: school.id, userId: { in: parentUserIds } },
      select: { id: true, userId: true },
    });
    if (guardians.length) {
      const links = await prisma.studentGuardian.groupBy({
        by: ["guardianId"],
        where: { schoolId: school.id, guardianId: { in: guardians.map((g) => g.id) } },
        _count: { _all: true },
      });
      const perGuardian = Object.fromEntries(links.map((l) => [l.guardianId, l._count._all]));
      for (const g of guardians) childrenByUser[g.userId] = (childrenByUser[g.userId] || 0) + (perGuardian[g.id] || 0);
    }
  }
  const members = { SCHOOL_ADMIN: [], PRINCIPAL: [], TEACHER: [], STAFF: [], PARENT: [] };
  for (const m of memberships) {
    (members[m.role] ||= []).push({
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      fullName: m.user.fullName,
      email: m.user.email,
      phone: m.user.phone,
      status: m.status,
      isActive: m.user.isActive,
      ...(m.role === "PARENT" ? { childrenCount: childrenByUser[m.userId] || 0 } : {}),
    });
  }
  const [students, classes] = await Promise.all([
    prisma.student.count({ where: { schoolId: school.id, status: "ACTIVE" } }),
    prisma.classroom.count({ where: { schoolId: school.id } }),
  ]);
  return res.json({ school: { ...school, students, classes }, members, total: memberships.length });
}));

// Phase 23: the operator can reset ANY member's password (teacher,
// parent, staff — not only the school admin), same pattern as the
// school-admin reset above.
router.post("/platform/schools/:schoolId/members/:membershipId/reset-password", asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["newPassword"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
  const membership = await prisma.schoolMembership.findFirst({
    where: { id: req.params.membershipId, schoolId: req.params.schoolId },
    select: { id: true, userId: true, role: true },
  });
  if (!membership) return res.status(404).json({ error: "MEMBER_NOT_FOUND" });
  await prisma.user.update({
    where: { id: membership.userId },
    data: { passwordHash: await hashPassword(req.body.newPassword) },
  });
  await revokeSessions(membership.userId);
  return res.json({ reset: true, role: membership.role });
}));

// Permanent delete: every school-scoped table, children before
// parents; then the school row itself.
const PURGE_TIERS = [
  ["notificationDelivery", "ticketMessage", "homeworkCompletion", "feePayment", "examMark", "ptmBooking", "pickupLog", "noticeRecipient", "noticeTarget", "studentGuardian", "communicationConsent", "cardCredential", "studentScanEvent", "staffScanEvent", "studentAttendance", "staffAttendance", "attendanceAudit", "attendanceCorrectionRequest", "teacherClassAssignment", "classInchargeAssignment", "timetableSlot"],
  ["notificationOutbox", "supportTicket", "ptmSlot", "pickupApproval", "pickupPerson", "homework", "leaveApplication", "feeInvoice", "exam", "feeStructure", "notice", "holiday", "calendarEvent"],
  ["student", "guardian", "teacherProfile", "subject", "feeHead", "classroom", "device", "attendancePolicy", "pushDeviceToken", "auditLog", "academicYear", "schoolMembership"],
];

router.delete("/platform/schools/:schoolId", asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ error: "NOT_FOUND" });
  // No single mega-transaction: ~46 sequential deletes over the hosted
  // pooler outlive Prisma's interactive-tx timeout (learned live,
  // Phase 21). Each deleteMany is its own implicit transaction and
  // every step is idempotent, so a failed delete can simply be
  // retried — already-purged tables no-op.
  // Step-labelled: if a step ever fails live, the response names the
  // exact table instead of a bare INTERNAL_ERROR.
  let step = "FeeInvoiceItem(raw)";
  try {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "FeeInvoiceItem" WHERE "invoiceId" IN (SELECT "id" FROM "FeeInvoice" WHERE "schoolId" = $1)',
      schoolId
    );
    for (const tier of PURGE_TIERS) {
      for (const model of tier) {
        step = model;
        await prisma[model].deleteMany({ where: { schoolId } });
      }
    }
    step = "School";
    await prisma.school.delete({ where: { id: schoolId } });
  } catch (e) {
    console.error("school purge failed at step:", step, e?.message || e);
    return res.status(500).json({ error: "PURGE_FAILED", step });
  }
  return res.json({ deleted: true, schoolId });
}));

export default router;
