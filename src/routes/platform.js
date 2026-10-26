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
import { normalizePhone } from "../services/otp.js";
import { parseRemoval, softRemoveMember, removedMembers } from "../utils/memberRemoval.js";
import { childrenByParentUser, classLabel } from "../utils/parentChildren.js";
import { fetchActivityPage, parsePagination } from "../utils/activity.js";

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

// Phase 28: GLOBAL platform search — one box on the owner's
// dashboard finds a school, a member (any role, any school), a
// guardian or a student across the WHOLE platform, by name, login
// email, mobile number or admission number. Phones also match on
// their digits-only form, so a number typed with spaces or a
// country code still hits.
// IMPORTANT: every query below uses an EXPLICIT Prisma `select` of
// long-existing columns only — full Student rows are never read, so
// this endpoint does NOT depend on the Phase 27 student columns
// (fatherName/motherName/address) existing in the database.
router.get("/platform/search", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ schools: [], people: [], students: [] });
  const contains = (v) => ({ contains: v, mode: "insensitive" });
  const digits = q.replace(/\D/g, "");
  const phoneTerms = [...new Set([q, digits].filter((s) => s.length >= 2))];
  const phoneOr = (field) => phoneTerms.map((t) => ({ [field]: contains(t) }));

  const [schools, memberships, students, guardians] = await Promise.all([
    prisma.school.findMany({
      where: { OR: [{ name: contains(q) }, { slug: contains(q) }] },
      select: { id: true, name: true, slug: true, status: true },
      orderBy: { name: "asc" },
      take: 20,
    }),
    prisma.schoolMembership.findMany({
      where: {
        status: { not: "INACTIVE" },
        user: { OR: [{ fullName: contains(q) }, { email: contains(q) }, ...phoneOr("phone")] },
      },
      select: {
        id: true, userId: true, role: true, schoolId: true,
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        school: { select: { name: true } },
      },
      orderBy: { user: { fullName: "asc" } },
      take: 20,
    }),
    prisma.student.findMany({
      where: { OR: [{ fullName: contains(q) }, { admissionNo: contains(q) }] },
      select: {
        id: true, fullName: true, admissionNo: true, schoolId: true, status: true,
        classroom: { select: { name: true, section: true } },
        school: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: 20,
    }),
    // Guardians are searched directly too: a parent who has a
    // guardian record but no login (or whose login name differs)
    // is still findable by the guardian name / mobile number.
    prisma.guardian.findMany({
      where: { OR: [{ fullName: contains(q) }, { email: contains(q) }, ...phoneOr("phone")] },
      select: {
        id: true, schoolId: true, userId: true, fullName: true, phone: true, email: true,
        school: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: 20,
    }),
  ]);

  // Child labels ("Aarav Singh · 1-A") for the PARENT results — one
  // batched lookup over every matched parent login / guardian, the
  // same shape as utils/parentChildren.js but pre-Phase-27 columns.
  const childrenByKey = {}; // `${schoolId}|${userId}` -> ["Name · 1-A"]
  const childrenByGuardian = {}; // guardianId -> ["Name · 1-A"]
  const parentUserIds = [...new Set([
    ...memberships.filter((m) => m.role === "PARENT").map((m) => m.userId),
    ...guardians.map((g) => g.userId).filter(Boolean),
  ])];
  const memberGuardians = parentUserIds.length
    ? await prisma.guardian.findMany({
        where: { userId: { in: parentUserIds } },
        select: { id: true, schoolId: true, userId: true },
      })
    : [];
  const allGuardianIds = [...new Set([...memberGuardians.map((g) => g.id), ...guardians.map((g) => g.id)])];
  if (allGuardianIds.length) {
    const keyByGuardian = Object.fromEntries(memberGuardians.map((g) => [g.id, `${g.schoolId}|${g.userId}`]));
    const links = await prisma.studentGuardian.findMany({
      where: { guardianId: { in: allGuardianIds } },
      select: {
        guardianId: true,
        student: { select: { id: true, fullName: true, classroom: { select: { name: true, section: true } } } },
      },
    });
    const seen = new Set();
    for (const l of links) {
      if (!l.student || seen.has(`${l.guardianId}|${l.student.id}`)) continue;
      seen.add(`${l.guardianId}|${l.student.id}`);
      const lbl = classLabel(l.student.classroom);
      const label = lbl ? `${l.student.fullName} · ${lbl}` : l.student.fullName;
      (childrenByGuardian[l.guardianId] ||= []).push(label);
      const key = keyByGuardian[l.guardianId];
      if (key) (childrenByKey[key] ||= []).push(label);
    }
  }

  const people = memberships.map((m) => ({
    userId: m.user.id,
    membershipId: m.id,
    guardianId: null,
    fullName: m.user.fullName,
    email: m.user.email,
    phone: m.user.phone,
    role: m.role,
    schoolId: m.schoolId,
    schoolName: m.school.name,
    children: m.role === "PARENT" ? childrenByKey[`${m.schoolId}|${m.userId}`] || [] : [],
  }));
  const memberKeys = new Set(
    people.filter((p) => p.role === "PARENT" && p.userId).map((p) => `${p.schoolId}|${p.userId}`)
  );
  for (const g of guardians) {
    if (g.userId && memberKeys.has(`${g.schoolId}|${g.userId}`)) continue; // already a member result
    people.push({
      userId: g.userId || null,
      membershipId: null,
      guardianId: g.id,
      fullName: g.fullName,
      email: g.email,
      phone: g.phone,
      role: "PARENT",
      schoolId: g.schoolId,
      schoolName: g.school.name,
      children: childrenByGuardian[g.id] || [],
    });
  }
  people.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return res.json({
    schools,
    people: people.slice(0, 20),
    students: students.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      admissionNo: s.admissionNo,
      classLabel: classLabel(s.classroom),
      schoolId: s.schoolId,
      schoolName: s.school.name,
      status: s.status,
    })),
  });
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
    where: { schoolId: school.id, status: { not: "INACTIVE" } },
    include: { user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Parents: WHICH children each parent login is linked to (names +
  // class labels), not just a count — resolved in one batched lookup
  // up front (utils/parentChildren.js); no transaction is involved.
  const parentUserIds = memberships.filter((m) => m.role === "PARENT").map((m) => m.userId);
  const childrenByUser = await childrenByParentUser(school.id, parentUserIds);
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
      ...(m.role === "PARENT"
        ? { childrenCount: (childrenByUser[m.userId] || []).length, children: childrenByUser[m.userId] || [] }
        : {}),
    });
  }
  const [students, classes] = await Promise.all([
    prisma.student.count({ where: { schoolId: school.id, status: "ACTIVE" } }),
    prisma.classroom.count({ where: { schoolId: school.id } }),
  ]);
  const removed = await removedMembers(school.id);
  return res.json({ school: { ...school, students, classes }, members, total: memberships.length, removed });
}));

// Phase 23: the operator ADDS members to a school directly — the
// same find-or-create-user + membership + parent-guardian-link logic
// as POST /schools/:id/users, minus the in-school permission gate.
const MEMBER_ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"];
router.post("/platform/schools/:schoolId/members", asyncRoute(async (req, res) => {
  const school = await prisma.school.findUnique({ where: { id: req.params.schoolId }, select: { id: true } });
  if (!school) return res.status(404).json({ error: "NOT_FOUND" });
  const missing = requireFields(req.body, ["email", "fullName", "role"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  if (!MEMBER_ROLES.includes(req.body.role)) return res.status(400).json({ error: "INVALID_ROLE" });
  let user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user) {
    if (!req.body.password) return res.status(400).json({ error: "PASSWORD_REQUIRED_FOR_NEW_USER" });
    if (String(req.body.password).length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
    user = await prisma.user.create({
      data: {
        email: req.body.email,
        phone: req.body.phone,
        fullName: req.body.fullName,
        passwordHash: await hashPassword(req.body.password),
      },
    });
  }
  const existing = await prisma.schoolMembership.findFirst({
    where: { schoolId: school.id, userId: user.id },
    select: { id: true },
  });
  if (existing) return res.status(400).json({ error: "ALREADY_A_MEMBER" });
  const membership = await prisma.schoolMembership.create({
    data: { schoolId: school.id, userId: user.id, role: req.body.role },
  });
  let guardiansLinked = 0;
  if (req.body.role === "PARENT" && req.body.guardianPhone) {
    const phone = normalizePhone(req.body.guardianPhone);
    if (phone) {
      const guardians = await prisma.guardian.findMany({ where: { schoolId: school.id } });
      for (const g of guardians) {
        if (normalizePhone(g.phone) === phone && g.userId !== user.id) {
          await prisma.guardian.update({ where: { id: g.id }, data: { userId: user.id } });
          guardiansLinked += 1;
        }
      }
    }
  }
  return res.status(201).json({ userId: user.id, membership, guardiansLinked });
}));

// Phase 23: the operator EDITS a member — name / login email /
// phone on the user record, membership status on the membership.
// The login-profile fields are validated BEFORE anything is saved
// (a rejected edit changes nothing): name must be non-empty, the
// login email must be well-formed, and an email owned by another
// user is a 409 conflict. Changing the login email is a credential
// change — like a password reset, the member's sessions are revoked
// so they sign in fresh with the new email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.patch("/platform/schools/:schoolId/members/:membershipId", asyncRoute(async (req, res) => {
  const membership = await prisma.schoolMembership.findFirst({
    where: { id: req.params.membershipId, schoolId: req.params.schoolId },
  });
  if (!membership) return res.status(404).json({ error: "MEMBER_NOT_FOUND" });
  const { fullName, email, phone, status } = req.body || {};
  const userData = {};
  if (fullName !== undefined) {
    const name = String(fullName).trim();
    if (!name) return res.status(400).json({ error: "FULL_NAME_REQUIRED" });
    userData.fullName = name;
  }
  if (phone !== undefined) userData.phone = phone || null;
  let emailChanged = false;
  if (email !== undefined) {
    const newEmail = String(email || "").trim();
    if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: "INVALID_EMAIL" });
    const current = await prisma.user.findUnique({ where: { id: membership.userId }, select: { email: true } });
    if (newEmail !== current?.email) {
      const taken = await prisma.user.findUnique({ where: { email: newEmail } });
      if (taken) return res.status(409).json({ error: "EMAIL_ALREADY_IN_USE" });
      userData.email = newEmail;
      emailChanged = true;
    }
  }
  if (status !== undefined) {
    if (!["ACTIVE", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "STATUS_MUST_BE_ACTIVE_OR_SUSPENDED" });
    await prisma.schoolMembership.update({ where: { id: membership.id }, data: { status } });
  }
  if (Object.keys(userData).length) {
    await prisma.user.update({ where: { id: membership.userId }, data: userData });
  }
  if (emailChanged) await revokeSessions(membership.userId);
  const fresh = await prisma.schoolMembership.findUnique({
    where: { id: membership.id },
    include: { user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } } },
  });
  return res.json({ member: {
    membershipId: fresh.id, userId: fresh.userId, role: fresh.role, status: fresh.status,
    fullName: fresh.user.fullName, email: fresh.user.email, phone: fresh.user.phone, isActive: fresh.user.isActive,
  } });
}));

// Phase 23: the operator REMOVES a member from a school — always a
// recorded soft removal (reason required; see utils/memberRemoval).
router.delete("/platform/schools/:schoolId/members/:membershipId", asyncRoute(async (req, res) => {
  const parsed = parseRemoval(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const membership = await prisma.schoolMembership.findFirst({
    where: { id: req.params.membershipId, schoolId: req.params.schoolId },
    select: { id: true, userId: true, role: true },
  });
  if (!membership) return res.status(404).json({ error: "MEMBER_NOT_FOUND" });
  const { userDeactivated } = await softRemoveMember({
    schoolId: req.params.schoolId, membership, actorUserId: req.user.id,
    reason: parsed.reason, note: parsed.note,
  });
  return res.json({ removed: true, reason: parsed.reason, userDeactivated, role: membership.role });
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

// Phase 29 WS2: platform-wide activity log (operator only — the
// router-level requirePlatform guard above covers this route).
// Optional ?schoolId= and ?action= filters, ?page=&pageSize=
// (default 25, cap 100), latest first. Rows with no schoolId
// (platform-level actions) are included with schoolName null.
// Item shape is shared with the school-scoped endpoint via
// utils/activity.js — everything the UI needs in one call.
router.get("/platform/activity", asyncRoute(async (req, res) => {
  const { page, pageSize } = parsePagination(req.query);
  const where = {};
  if (req.query.schoolId) where.schoolId = String(req.query.schoolId);
  if (req.query.action) where.action = String(req.query.action);
  const result = await fetchActivityPage({ where, page, pageSize });
  return res.json(result);
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
