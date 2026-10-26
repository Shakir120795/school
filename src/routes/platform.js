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

// Permanent delete: every school-scoped table, children before
// parents, in one transaction; then the school row itself.
const PURGE_TIERS = [
  ["notificationDelivery", "ticketMessage", "homeworkCompletion", "feePayment", "examMark", "ptmBooking", "pickupLog", "noticeRecipient", "noticeTarget", "studentGuardian", "communicationConsent", "cardCredential", "studentScanEvent", "staffScanEvent", "studentAttendance", "staffAttendance", "attendanceAudit", "attendanceCorrectionRequest", "teacherClassAssignment", "classInchargeAssignment", "timetableSlot"],
  ["notificationOutbox", "supportTicket", "ptmSlot", "pickupApproval", "pickupPerson", "homework", "leaveApplication", "feeInvoice", "exam", "feeStructure", "notice", "holiday", "calendarEvent"],
  ["student", "guardian", "teacherProfile", "subject", "feeHead", "classroom", "device", "attendancePolicy", "pushDeviceToken", "auditLog", "academicYear", "schoolMembership"],
];

router.delete("/platform/schools/:schoolId", asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ error: "NOT_FOUND" });
  await prisma.$transaction(async (tx) => {
    // FeeInvoiceItem has no schoolId column — purge via its invoices.
    await tx.$executeRawUnsafe(
      'DELETE FROM "FeeInvoiceItem" WHERE "invoiceId" IN (SELECT "id" FROM "FeeInvoice" WHERE "schoolId" = $1)',
      schoolId
    );
    for (const tier of PURGE_TIERS) {
      for (const model of tier) {
        await tx[model].deleteMany({ where: { schoolId } });
      }
    }
    await tx.school.delete({ where: { id: schoolId } });
  });
  return res.json({ deleted: true, schoolId });
}));

export default router;
