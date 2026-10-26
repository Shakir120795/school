import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool, ADMIN_ROLES } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { hashPassword, randomToken, hashToken } from "../utils/security.js";
import { normalizePhone } from "../services/otp.js";
import { parseRemoval, softRemoveMember, removedMembers } from "../utils/memberRemoval.js";
import { childrenByParentUser, classLabel } from "../utils/parentChildren.js";
import { fetchActivityPage, parsePagination } from "../utils/activity.js";
import { teacherClassIds } from "../services/teacherClasses.js";

const router = Router();
const WRITE = ADMIN_ROLES;
const READ = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STAFF"];

// Optional free-text field (Phase 27 family details etc.): a provided
// value must be a string; it is trimmed and an empty string clears
// the field (null). Returns undefined when the field was not sent.
function optStr(body, field) {
  const v = body?.[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return { error: `${field.toUpperCase()}_MUST_BE_A_STRING` };
  const s = v.trim();
  return s ? s : null;
}

// --- Platform level -------------------------------------------------------
router.post(
  "/",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!req.user.isPlatformAdmin) return res.status(403).json({ error: "PLATFORM_ADMIN_ONLY" });
    const missing = requireFields(req.body, ["name", "slug", "adminEmail", "adminPassword", "adminName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: { name: req.body.name, slug: req.body.slug, timezone: req.body.timezone || "Asia/Kolkata" },
      });
      const adminUser = await tx.user.create({
        data: {
          email: req.body.adminEmail,
          fullName: req.body.adminName,
          passwordHash: await hashPassword(req.body.adminPassword),
        },
      });
      await tx.schoolMembership.create({
        data: { schoolId: school.id, userId: adminUser.id, role: "SCHOOL_ADMIN" },
      });
      return { school, adminUser };
    });
    return res.status(201).json({ school: result.school, adminUserId: result.adminUser.id });
  })
);

router.get(
  "/mine",
  requireAuth,
  asyncRoute(async (req, res) => {
    const memberships = await prisma.schoolMembership.findMany({
      where: { userId: req.user.id, status: "ACTIVE" },
      include: { school: { select: { id: true, name: true, slug: true, timezone: true } } },
    });
    return res.json({ memberships });
  })
);

// --- School settings --------------------------------------------------------
router.get(
  "/:schoolId",
  requireAuth,
  requireSchool([]),
  asyncRoute(async (req, res) => res.json({ school: req.school }))
);

router.patch(
  "/:schoolId",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    // School profile: name/timezone + public profile the admin fills after
    // onboarding (logo, address, contact) — only provided fields change.
    const data = {};
    for (const f of ["name", "timezone", "logoUrl", "address", "phone", "email"]) {
      if (req.body[f] !== undefined) data[f] = req.body[f] === "" ? null : req.body[f];
    }
    if (data.logoUrl && !/^https?:\/\//i.test(data.logoUrl)) {
      return res.status(400).json({ error: "LOGO_URL_MUST_BE_HTTP_URL" });
    }
    const school = await prisma.school.update({ where: { id: req.params.schoolId }, data });
    return res.json({ school });
  })
);

// --- Academic years / classrooms / subjects ---------------------------------
function simpleCollection(model, fields, orderBy = { createdAt: "asc" }, optionalFields = []) {
  return {
    create: asyncRoute(async (req, res) => {
      const missing = requireFields(req.body, fields);
      if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
      const data = { schoolId: req.params.schoolId };
      for (const f of fields) data[f] = req.body[f];
      for (const f of optionalFields) if (req.body[f] !== undefined && req.body[f] !== "") data[f] = req.body[f];
      if (model === "academicYear") {
        data.startsOn = new Date(req.body.startsOn);
        data.endsOn = new Date(req.body.endsOn);
      }
      const row = await prisma[model].create({ data });
      return res.status(201).json({ [model]: row });
    }),
    list: asyncRoute(async (req, res) => {
      const rows = await prisma[model].findMany({ where: { schoolId: req.params.schoolId }, orderBy });
      return res.json({ [model + "s"]: rows });
    }),
  };
}

const years = simpleCollection("academicYear", ["name", "startsOn", "endsOn"]);
router.post("/:schoolId/academic-years", requireAuth, requireSchool(WRITE), years.create);
router.get("/:schoolId/academic-years", requireAuth, requireSchool(READ), years.list);

// section/gradeLevel are OPTIONAL pass-throughs: the Settings UI
// has always sent a section ("A"/"B") that used to be silently
// dropped here, leaving every classroom section-less.
const rooms = simpleCollection("classroom", ["academicYearId", "name"], { createdAt: "asc" }, ["section", "gradeLevel"]);
router.post("/:schoolId/classrooms", requireAuth, requireSchool(WRITE), rooms.create);
router.get("/:schoolId/classrooms", requireAuth, requireSchool(READ), rooms.list);

const subjects = simpleCollection("subject", ["name", "code"]);
router.post("/:schoolId/subjects", requireAuth, requireSchool(WRITE), subjects.create);
router.get("/:schoolId/subjects", requireAuth, requireSchool(READ), subjects.list);

// --- Users & memberships ------------------------------------------------------
router.post(
  "/:schoolId/users",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["email", "fullName", "role"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const schoolId = req.params.schoolId;
    let user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (!user) {
      if (!req.body.password) return res.status(400).json({ error: "PASSWORD_REQUIRED_FOR_NEW_USER" });
      user = await prisma.user.create({
        data: {
          email: req.body.email,
          phone: req.body.phone,
          fullName: req.body.fullName,
          passwordHash: await hashPassword(req.body.password),
        },
      });
    }
    const membership = await prisma.schoolMembership.create({
      data: { schoolId, userId: user.id, role: req.body.role },
    });
    // Parent ID/password login: when the school issues a PARENT login
    // and gives the guardian's mobile, link that guardian record to
    // this user so the parent immediately sees their children
    // (same link the OTP flow creates automatically).
    let guardiansLinked = 0;
    if (req.body.role === "PARENT" && req.body.guardianPhone) {
      const phone = normalizePhone(req.body.guardianPhone);
      if (phone) {
        const guardians = await prisma.guardian.findMany({ where: { schoolId } });
        for (const g of guardians) {
          if (normalizePhone(g.phone) === phone && g.userId !== user.id) {
            await prisma.guardian.update({ where: { id: g.id }, data: { userId: user.id } });
            guardiansLinked += 1;
          }
        }
      }
    }
    return res.status(201).json({ userId: user.id, membership, guardiansLinked });
  })
);

router.get(
  "/:schoolId/users",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const memberships = await prisma.schoolMembership.findMany({
      where: { schoolId: req.params.schoolId },
      include: { user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } } },
    });
    // Parents: attach their linked children (name + class label) so
    // Team page rows show WHO is in which class, not just a count —
    // same batched lookup as the platform console member list.
    const parentUserIds = memberships.filter((m) => m.role === "PARENT").map((m) => m.userId);
    const childrenByUser = await childrenByParentUser(req.params.schoolId, parentUserIds);
    return res.json({
      memberships: memberships.map((m) =>
        m.role === "PARENT"
          ? { ...m, childrenCount: (childrenByUser[m.userId] || []).length, children: childrenByUser[m.userId] || [] }
          : m
      ),
    });
  })
);

// Edit a member of THIS school (Phase 23 school-side CRUD):
// membership status (activate/suspend) and/or the login profile
// fields — fullName / login email / phone — on the user record.
// Same validation contract as the operator endpoint (platform.js):
// profile fields are validated BEFORE anything is saved — name
// non-empty, email well-formed, an email owned by another user is a
// 409 conflict — and an actual email change revokes the member's
// sessions (the reset-password precedent), since the login ID moved.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.patch(
  "/:schoolId/users/:membershipId",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const { status, fullName, email, phone } = req.body || {};
    const target = await prisma.schoolMembership.findFirst({
      where: { id: req.params.membershipId, schoolId: req.params.schoolId },
    });
    if (!target) return res.status(404).json({ error: "MEMBERSHIP_NOT_FOUND" });
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
      const current = await prisma.user.findUnique({ where: { id: target.userId }, select: { email: true } });
      if (newEmail !== current?.email) {
        const taken = await prisma.user.findUnique({ where: { email: newEmail } });
        if (taken) return res.status(409).json({ error: "EMAIL_ALREADY_IN_USE" });
        userData.email = newEmail;
        emailChanged = true;
      }
    }
    if (status !== undefined) {
      if (!["ACTIVE", "SUSPENDED"].includes(status)) {
        return res.status(400).json({ error: "STATUS_MUST_BE_ACTIVE_OR_SUSPENDED" });
      }
      if (target.id === req.membership.id) return res.status(400).json({ error: "CANNOT_CHANGE_OWN_STATUS" });
      await prisma.schoolMembership.update({ where: { id: target.id }, data: { status } });
    }
    if (Object.keys(userData).length) {
      await prisma.user.update({ where: { id: target.userId }, data: userData });
    }
    if (emailChanged) {
      await prisma.authSession.updateMany({
        where: { userId: target.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const membership = await prisma.schoolMembership.findUnique({
      where: { id: target.id },
      include: { user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } } },
    });
    return res.json({ membership });
  })
);

// Phase 29 WS2: activity log for THIS school only — SCHOOL_ADMIN /
// PRINCIPAL of this school (WRITE). requireSchool resolves the
// school from :schoolId and 403s non-members / wrong roles and
// 404s an unknown school, per the existing conventions; the query
// is forced to this school's rows regardless of any query params.
// Same item shape + pagination/action filter as /platform/activity.
router.get(
  "/:schoolId/activity",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query);
    const where = { schoolId: req.params.schoolId };
    if (req.query.action) where.action = String(req.query.action);
    const result = await fetchActivityPage({ where, page, pageSize });
    return res.json(result);
  })
);

// Phase 29 WS4: setup-wizard status for THIS school — SCHOOL_ADMIN /
// PRINCIPAL only (WRITE). Six booleans + counts, computed with count
// queries ONLY: no rows are selected, so this stays safe even where
// a list endpoint would trip over pending columns (e.g. students).
// Each count is independent; Promise.all surfaces a real failure to
// the error handler rather than silently ticking a step.
router.get(
  "/:schoolId/setup-status",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const [years, classrooms, teachers, students, policies, feeStructures] = await Promise.all([
      prisma.academicYear.count({ where: { schoolId } }),
      prisma.classroom.count({ where: { schoolId } }),
      prisma.schoolMembership.count({ where: { schoolId, role: "TEACHER", status: "ACTIVE" } }),
      prisma.student.count({ where: { schoolId } }),
      prisma.attendancePolicy.count({ where: { schoolId, isActive: true } }),
      prisma.feeStructure.count({ where: { schoolId } }),
    ]);
    const steps = {
      academicYear: { done: years > 0, count: years },
      classes: { done: classrooms > 0, count: classrooms },
      teachers: { done: teachers > 0, count: teachers },
      students: { done: students > 0, count: students },
      attendancePolicy: { done: policies > 0, count: policies },
      feeStructure: { done: feeStructures > 0, count: feeStructures },
    };
    const complete = Object.values(steps).every((s) => s.done);
    return res.json({ steps, complete });
  })
);

// Removed members of THIS school, with their removal records.
router.get(
  "/:schoolId/users/removed",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    return res.json({ removed: await removedMembers(req.params.schoolId) });
  })
);

// Remove a member from THIS school (Phase 23): a recorded soft
// removal — reason required ("Other" needs a note). Same shared
// logic as the operator console remove.
router.delete(
  "/:schoolId/users/:membershipId",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const parsed = parseRemoval(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const target = await prisma.schoolMembership.findFirst({
      where: { id: req.params.membershipId, schoolId: req.params.schoolId },
      select: { id: true, userId: true, role: true },
    });
    if (!target) return res.status(404).json({ error: "MEMBERSHIP_NOT_FOUND" });
    if (target.id === req.membership.id) return res.status(400).json({ error: "CANNOT_REMOVE_SELF" });
    const { userDeactivated } = await softRemoveMember({
      schoolId: req.params.schoolId,
      membership: target,
      actorUserId: req.user.id,
      reason: parsed.reason,
      note: parsed.note,
    });
    return res.json({ removed: true, reason: parsed.reason, userDeactivated, role: target.role });
  })
);

// Reset a team member's password (Phase 21): school managers can hand
// a teacher/staff member a fresh password; their old sessions die.
router.post(
  "/:schoolId/users/:membershipId/reset-password",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["newPassword"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
    const target = await prisma.schoolMembership.findFirst({
      where: { id: req.params.membershipId, schoolId: req.params.schoolId },
    });
    if (!target) return res.status(404).json({ error: "MEMBERSHIP_NOT_FOUND" });
    await prisma.user.update({
      where: { id: target.userId },
      data: { passwordHash: await hashPassword(req.body.newPassword) },
    });
    await prisma.authSession.updateMany({
      where: { userId: target.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.json({ reset: true });
  })
);

// --- Students -------------------------------------------------------------------
router.post(
  "/:schoolId/students",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["admissionNo", "fullName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    // Family details (Phase 27): optional strings, validated the
    // same way as the PATCH endpoint below.
    const family = {};
    for (const f of ["fatherName", "motherName", "address"]) {
      const v = optStr(req.body, f);
      if (v && typeof v === "object") return res.status(400).json({ error: v.error });
      if (v !== undefined) family[f] = v;
    }
    const student = await prisma.student.create({
      data: {
        schoolId: req.params.schoolId,
        admissionNo: req.body.admissionNo,
        fullName: req.body.fullName,
        academicYearId: req.body.academicYearId,
        classroomId: req.body.classroomId,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : undefined,
        gender: req.body.gender,
        rollNo: req.body.rollNo || undefined,
        photoUrl: req.body.photoUrl || undefined,
        ...family,
      },
    });
    return res.status(201).json({ student });
  })
);

router.get(
  "/:schoolId/students",
  requireAuth,
  requireSchool(READ),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const where = { schoolId };
    if (req.query.classroomId) where.classroomId = req.query.classroomId;
    if (req.membership.role === "TEACHER") {
      // Teachers see only students of classes they are assigned to.
      const profile = await prisma.teacherProfile.findUnique({
        where: { membershipId: req.membership.id },
        include: { classAssignments: { select: { classroomId: true } } },
      });
      const classIds = [...new Set((profile?.classAssignments || []).map((a) => a.classroomId))];
      where.classroomId = where.classroomId
        ? classIds.includes(where.classroomId)
          ? where.classroomId
          : "__none__"
        : { in: classIds };
    }
    if (req.membership.role === "PARENT") {
      const guardianIds = (
        await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } })
      ).map((g) => g.id);
      const links = await prisma.studentGuardian.findMany({
        where: { schoolId, guardianId: { in: guardianIds } },
        select: { studentId: true },
      });
      where.id = { in: links.map((l) => l.studentId) };
    }
    const rows = await prisma.student.findMany({
      where,
      orderBy: { fullName: "asc" },
      // Phase 27: each student carries their primary guardian's
      // name + phone — the "Mobile" on the student detail cards
      // (People page + teacher My Students). One joined query,
      // primary link first; the raw links are not exposed.
      include: {
        guardianLinks: {
          include: { guardian: { select: { fullName: true, phone: true, relationship: true } } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
    });
    const students = rows.map(({ guardianLinks, ...s }) => ({
      ...s,
      guardian: guardianLinks?.[0]
        ? {
            name: guardianLinks[0].guardian.fullName,
            phone: guardianLinks[0].guardian.phone,
            relationship: guardianLinks[0].guardian.relationship,
          }
        : null,
    }));
    return res.json({ students });
  })
);

// Phase 29 WS5: Student 360 profile — ONE aggregate read for the
// /students/:studentId page: core + family + guardians + last-30
// attendance + fees + targeted notices. Roles: SCHOOL_ADMIN /
// PRINCIPAL / STAFF may read any student in their school; TEACHER
// only students in classrooms they are assigned to (subject or
// current incharge — services/teacherClasses.js, the same scoping
// roll-call uses); PARENT is excluded by requireSchool below (403
// INSUFFICIENT_ROLE) — parents have their own /parent view.
// Cross-school ids 404 via the schoolId-scoped lookup (and
// requireSchool already 403s non-members of :schoolId).
// Phase-27 guard: the core query uses an EXPLICIT select of
// pre-existing columns ONLY. Family fields (fatherName /
// motherName / address) are fetched in a SEPARATE query wrapped
// in try/catch: until the owner's SQL creates those columns in
// the live DB that query throws, we catch it and return
// family: null (the UI shows "—"); once the columns exist the
// same code starts returning values with no change.
const PROFILE_ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"];
router.get(
  "/:schoolId/students/:studentId/profile",
  requireAuth,
  requireSchool(PROFILE_ROLES),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const studentId = req.params.studentId;
    const core = await prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: {
        id: true, fullName: true, admissionNo: true, rollNo: true,
        gender: true, dateOfBirth: true, status: true, photoUrl: true,
        classroomId: true, academicYearId: true,
        classroom: { select: { id: true, name: true, section: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });
    if (!core) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    if (req.membership.role === "TEACHER") {
      const classIds = await teacherClassIds(schoolId, req.membership.id);
      if (!core.classroomId || !classIds.includes(core.classroomId)) {
        return res.status(403).json({ error: "STUDENT_NOT_IN_YOUR_CLASSES" });
      }
    }
    let family = null;
    try {
      const fam = await prisma.student.findFirst({
        where: { id: studentId, schoolId },
        select: { fatherName: true, motherName: true, address: true },
      });
      if (fam) family = { fatherName: fam.fatherName || null, motherName: fam.motherName || null, address: fam.address || null };
    } catch {
      family = null;
    }
    const [guardianLinks, attendanceRows, invoices, notices] = await Promise.all([
      prisma.studentGuardian.findMany({
        where: { schoolId, studentId },
        select: {
          id: true, relation: true, isPrimary: true,
          guardian: { select: { id: true, fullName: true, phone: true, email: true, relationship: true } },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      }),
      prisma.studentAttendance.findMany({
        where: { schoolId, studentId },
        select: { id: true, localDate: true, status: true, entryAt: true, exitAt: true, isLate: true, reviewFlag: true },
        orderBy: { localDate: "desc" },
        take: 30,
      }),
      prisma.feeInvoice.findMany({
        where: { schoolId, studentId },
        select: { id: true, periodLabel: true, title: true, totalPaise: true, dueDate: true, status: true, classroomId: true, createdAt: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      }),
      // Targeted notices only: NoticeTarget rows pointing at this
      // student or at their classroom (a trivial relation lookup).
      core.classroomId || studentId
        ? prisma.notice.findMany({
            where: {
              schoolId,
              status: { in: ["SENT", "SENDING"] },
              targets: {
                some: {
                  OR: [
                    { studentId },
                    ...(core.classroomId ? [{ classroomId: core.classroomId }] : []),
                  ],
                },
              },
            },
            select: { id: true, title: true, body: true, type: true, status: true, sentAt: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          })
        : Promise.resolve([]),
    ]);
    const guardians = guardianLinks.map((l) => ({
      id: l.guardian.id,
      linkId: l.id,
      name: l.guardian.fullName,
      phone: l.guardian.phone || null,
      email: l.guardian.email || null,
      relationship: l.relation || l.guardian.relationship || null,
      isPrimary: !!l.isPrimary,
    }));
    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, HALF_DAY: 0 };
    for (const r of attendanceRows) if (counts[r.status] !== undefined) counts[r.status] += 1;
    const presentCount = counts.PRESENT + counts.LATE;
    const attendance = {
      records: attendanceRows.map((r) => ({
        id: r.id,
        date: r.localDate,
        status: r.status,
        entryAt: r.entryAt,
        exitAt: r.exitAt,
        isLate: r.isLate,
        reviewFlag: r.reviewFlag,
      })),
      summary: {
        total: attendanceRows.length,
        present: presentCount,
        late: counts.LATE,
        absent: counts.ABSENT,
        onLeave: counts.ON_LEAVE,
        halfDay: counts.HALF_DAY,
        counts,
        pctPresent: attendanceRows.length ? Math.round((presentCount / attendanceRows.length) * 100) : 0,
      },
    };
    let paidOf = {};
    if (invoices.length) {
      const paidRows = await prisma.feePayment.groupBy({
        by: ["invoiceId"],
        where: { schoolId, invoiceId: { in: invoices.map((i) => i.id) } },
        _sum: { amountPaise: true },
      });
      paidOf = Object.fromEntries(paidRows.map((r) => [r.invoiceId, r._sum.amountPaise || 0]));
    }
    const feeInvoices = invoices.map((i) => {
      const paidPaise = paidOf[i.id] || 0;
      return {
        id: i.id, periodLabel: i.periodLabel, title: i.title, status: i.status,
        totalPaise: i.totalPaise, paidPaise, balancePaise: i.totalPaise - paidPaise,
        duePaise: i.totalPaise - paidPaise, dueDate: i.dueDate, classroomId: i.classroomId, createdAt: i.createdAt,
      };
    });
    const totalBilled = invoices.filter((i) => i.status !== "WAIVED").reduce((a, i) => a + i.totalPaise, 0);
    const totalPaid = feeInvoices.reduce((a, i) => a + i.paidPaise, 0);
    const totalDue = invoices
      .filter((i) => i.status !== "WAIVED")
      .reduce((a, i) => a + Math.max(0, i.totalPaise - (paidOf[i.id] || 0)), 0);
    const { classroom, academicYear, ...coreFields } = core;
    return res.json({
      student: {
        ...coreFields,
        classroom: classroom ? { id: classroom.id, name: classroom.name, section: classroom.section } : null,
        classLabel: classLabel(classroom),
        academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
      },
      family,
      guardians,
      attendance,
      fees: { invoices: feeInvoices, totals: { totalBilled, totalPaid, totalDue } },
      notices,
    });
  })
);

// Update a student (Phase 27): profile + family details from the
// People page Edit form (and the seed backfill). Only provided
// fields change; optional strings are trimmed, empty clears.
// Phase 29 WS6 adds two audited manager actions on the same
// endpoint (WRITE = SCHOOL_ADMIN / PRINCIPAL):
//  - classroomId: a real change is a CLASS TRANSFER — the target
//    classroom must belong to the same school (400 otherwise) and
//    an AuditLog STUDENT_TRANSFERRED row records from/to ids +
//    class labels. Attendance / fees history is keyed by student,
//    never by classroom, so history stays attached untouched.
//  - admissionNo: a real change is an ADMISSION CORRECTION —
//    trimmed, must stay unique within the school (409
//    ADMISSION_NO_TAKEN, nothing saved) and an AuditLog
//    STUDENT_ADMISSION_CORRECTED row records old + new. NOTE:
//    parent login IDs derived from the old admission number do
//    NOT change automatically (the UI warns about this).
// Both changes in one PATCH apply together and log two rows.
// All validations run BEFORE the update, so a rejected PATCH
// saves nothing. The update returns an explicit CORE select
// (plus any family fields actually being written): the Phase 27
// family columns do not exist in the live DB yet, and a full-row
// RETURNING would 500 a classroomId/admissionNo-only PATCH.
router.patch(
  "/:schoolId/students/:studentId",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const target = await prisma.student.findFirst({
      where: { id: req.params.studentId, schoolId },
      select: {
        id: true, fullName: true, admissionNo: true, classroomId: true,
        classroom: { select: { id: true, name: true, section: true } },
      },
    });
    if (!target) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const body = req.body || {};
    const data = {};
    if (body.fullName !== undefined) {
      const name = typeof body.fullName === "string" ? body.fullName.trim() : "";
      if (!name) return res.status(400).json({ error: "FULL_NAME_REQUIRED" });
      data.fullName = name;
    }
    for (const f of ["gender", "fatherName", "motherName", "address", "rollNo", "photoUrl"]) {
      const v = optStr(body, f);
      if (v && typeof v === "object") return res.status(400).json({ error: v.error });
      if (v !== undefined) data[f] = v;
    }
    // Class transfer (WS6): validate the destination classroom
    // belongs to THIS school before anything is written.
    let transfer = null;
    if (body.classroomId !== undefined) {
      const nextClassroomId = body.classroomId || null;
      data.classroomId = nextClassroomId;
      if (nextClassroomId !== target.classroomId) {
        let toClassroom = null;
        if (nextClassroomId) {
          toClassroom = await prisma.classroom.findFirst({
            where: { id: nextClassroomId, schoolId },
            select: { id: true, name: true, section: true },
          });
          if (!toClassroom) return res.status(400).json({ error: "CLASSROOM_NOT_IN_SCHOOL" });
        }
        transfer = { toClassroom };
      }
    }
    // Admission correction (WS6): trimmed + unique within school.
    let admissionChange = null;
    if (body.admissionNo !== undefined) {
      if (typeof body.admissionNo !== "string") {
        return res.status(400).json({ error: "ADMISSION_NO_MUST_BE_A_STRING" });
      }
      const nextAdmissionNo = body.admissionNo.trim();
      if (!nextAdmissionNo) return res.status(400).json({ error: "ADMISSION_NO_REQUIRED" });
      if (nextAdmissionNo !== target.admissionNo) {
        const clash = await prisma.student.findFirst({
          where: { schoolId, admissionNo: nextAdmissionNo, id: { not: target.id } },
          select: { id: true },
        });
        if (clash) return res.status(409).json({ error: "ADMISSION_NO_TAKEN" });
        admissionChange = { from: target.admissionNo, to: nextAdmissionNo };
        data.admissionNo = nextAdmissionNo;
      }
    }
    if (body.academicYearId !== undefined) data.academicYearId = body.academicYearId || null;
    if (body.dateOfBirth !== undefined) {
      if (!body.dateOfBirth) data.dateOfBirth = null;
      else {
        const d = new Date(body.dateOfBirth);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "INVALID_DATE_OF_BIRTH" });
        data.dateOfBirth = d;
      }
    }
    if (body.status !== undefined) {
      if (!["ACTIVE", "INACTIVE", "LEFT", "SUSPENDED"].includes(body.status)) {
        return res.status(400).json({ error: "INVALID_STATUS" });
      }
      data.status = body.status;
    }
    const select = {
      id: true, schoolId: true, fullName: true, admissionNo: true, rollNo: true,
      photoUrl: true, gender: true, dateOfBirth: true, status: true,
      classroomId: true, academicYearId: true, createdAt: true, updatedAt: true,
    };
    for (const f of ["fatherName", "motherName", "address"]) if (f in data) select[f] = true;
    const student = await prisma.student.update({ where: { id: target.id }, data, select });
    // Audit AFTER the update (sequential awaits, no transaction —
    // pooler connection_limit=1 discipline, same as memberRemoval).
    if (transfer) {
      await prisma.auditLog.create({
        data: {
          schoolId,
          actorUserId: req.user.id,
          action: "STUDENT_TRANSFERRED",
          entityType: "Student",
          entityId: target.id,
          metadata: {
            studentName: target.fullName,
            fromClassroomId: target.classroomId || null,
            fromClassLabel: target.classroom ? classLabel(target.classroom) : null,
            toClassroomId: data.classroomId || null,
            toClassLabel: transfer.toClassroom ? classLabel(transfer.toClassroom) : null,
          },
        },
      });
    }
    if (admissionChange) {
      await prisma.auditLog.create({
        data: {
          schoolId,
          actorUserId: req.user.id,
          action: "STUDENT_ADMISSION_CORRECTED",
          entityType: "Student",
          entityId: target.id,
          metadata: {
            studentName: target.fullName,
            oldAdmissionNo: admissionChange.from,
            newAdmissionNo: admissionChange.to,
          },
        },
      });
    }
    return res.json({ student });
  })
);

// --- Guardians --------------------------------------------------------------------
router.post(
  "/:schoolId/guardians",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["fullName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: req.params.schoolId,
        fullName: req.body.fullName,
        phone: req.body.phone,
        email: req.body.email,
        relationship: req.body.relationship,
        userId: req.body.userId,
      },
    });
    return res.status(201).json({ guardian });
  })
);

router.post(
  "/:schoolId/students/:studentId/guardians",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["guardianId"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    // Composite FKs in the DB also reject cross-school links (P2003 -> 409).
    const link = await prisma.studentGuardian.create({
      data: {
        schoolId: req.params.schoolId,
        studentId: req.params.studentId,
        guardianId: req.body.guardianId,
        relation: req.body.relation,
        isPrimary: !!req.body.isPrimary,
      },
    });
    return res.status(201).json({ link });
  })
);

router.get(
  "/:schoolId/guardians",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: req.params.schoolId },
      include: { studentLinks: { select: { studentId: true, isPrimary: true } } },
      orderBy: { fullName: "asc" },
    });
    return res.json({ guardians });
  })
);

// --- Parent self-service -----------------------------------------------------------
router.get(
  "/:schoolId/my-children",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const guardians = await prisma.guardian.findMany({
      where: { schoolId, userId: req.user.id },
      include: {
        studentLinks: {
          include: {
            student: {
              include: {
                classroom: true,
                attendances: { orderBy: { localDate: "desc" }, take: 30 },
              },
            },
          },
        },
      },
    });
    const children = guardians.flatMap((g) => g.studentLinks.map((l) => l.student));
    return res.json({ children });
  })
);

// Parent communication preferences (consent per channel).
router.put(
  "/:schoolId/my-consents",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["channel"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: req.params.schoolId, userId: req.user.id },
      select: { id: true },
    });
    if (!guardians.length) return res.status(404).json({ error: "NO_GUARDIAN_PROFILE" });
    const results = [];
    for (const g of guardians) {
      results.push(
        await prisma.communicationConsent.upsert({
          where: { schoolId_guardianId_channel: { schoolId: req.params.schoolId, guardianId: g.id, channel: req.body.channel } },
          create: { schoolId: req.params.schoolId, guardianId: g.id, channel: req.body.channel, optedIn: req.body.optedIn !== false, source: "app-settings" },
          update: { optedIn: req.body.optedIn !== false, source: "app-settings" },
        })
      );
    }
    return res.json({ consents: results });
  })
);

// --- Teachers, assignments, incharge -------------------------------------------------
router.post(
  "/:schoolId/teachers",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["membershipId", "displayName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const membership = await prisma.schoolMembership.findFirst({
      where: { id: req.body.membershipId, schoolId: req.params.schoolId },
    });
    if (!membership) return res.status(404).json({ error: "MEMBERSHIP_NOT_FOUND_IN_SCHOOL" });
    const teacher = await prisma.teacherProfile.create({
      data: {
        schoolId: req.params.schoolId,
        membershipId: req.body.membershipId,
        displayName: req.body.displayName,
        photoUrl: req.body.photoUrl,
        approvedContactChannel: req.body.approvedContactChannel,
        isVisibleToParents: req.body.isVisibleToParents !== false,
      },
    });
    return res.status(201).json({ teacher });
  })
);

router.get(
  "/:schoolId/teachers",
  requireAuth,
  requireSchool(READ),
  asyncRoute(async (req, res) => {
    const where = { schoolId: req.params.schoolId, status: "ACTIVE" };
    // Parents only ever see school-approved, visible profiles.
    if (req.membership.role === "PARENT") where.isVisibleToParents = true;
    const teachers = await prisma.teacherProfile.findMany({
      where,
      include: {
        classAssignments: { include: { classroom: true, subject: true } },
        inchargeAssignments: { where: { effectiveTo: null }, include: { classroom: true } },
      },
      orderBy: { displayName: "asc" },
    });
    return res.json({ teachers });
  })
);

router.post(
  "/:schoolId/teacher-assignments",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["teacherId", "classroomId", "subjectId", "academicYearId"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const assignment = await prisma.teacherClassAssignment.create({
      data: { schoolId: req.params.schoolId, ...pick(req.body, ["teacherId", "classroomId", "subjectId", "academicYearId"]) },
    });
    return res.status(201).json({ assignment });
  })
);

router.post(
  "/:schoolId/class-incharge",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["teacherId", "classroomId", "academicYearId", "effectiveFrom"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const assignment = await prisma.classInchargeAssignment.create({
      data: {
        schoolId: req.params.schoolId,
        teacherId: req.body.teacherId,
        classroomId: req.body.classroomId,
        academicYearId: req.body.academicYearId,
        effectiveFrom: new Date(req.body.effectiveFrom),
        effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null,
      },
    });
    return res.status(201).json({ assignment });
  })
);

// --- Devices (gate scanners) ---------------------------------------------------------
router.post(
  "/:schoolId/devices",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["name"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const deviceKey = randomToken();
    const device = await prisma.device.create({
      data: { schoolId: req.params.schoolId, name: req.body.name, deviceKeyHash: hashToken(deviceKey) },
    });
    // The raw key is shown exactly once; only its hash is stored.
    return res.status(201).json({ device: { id: device.id, name: device.name, status: device.status }, deviceKey });
  })
);

router.get(
  "/:schoolId/devices",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const devices = await prisma.device.findMany({
      where: { schoolId: req.params.schoolId },
      select: { id: true, name: true, status: true, lastSeenAt: true },
    });
    return res.json({ devices });
  })
);

// --- ID cards (QR) ---------------------------------------------------------------------
router.post(
  "/:schoolId/cards",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["ownerType"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    if (req.body.ownerType === "STUDENT" && !req.body.studentId)
      return res.status(400).json({ error: "STUDENT_ID_REQUIRED" });
    if (req.body.ownerType === "STAFF" && !req.body.teacherProfileId)
      return res.status(400).json({ error: "TEACHER_PROFILE_ID_REQUIRED" });
    const token = randomToken();
    const card = await prisma.cardCredential.create({
      data: {
        schoolId: req.params.schoolId,
        ownerType: req.body.ownerType,
        studentId: req.body.studentId,
        teacherProfileId: req.body.teacherProfileId,
        tokenHash: hashToken(token),
      },
    });
    // QR payload = this opaque token only. Shown once at issuance; DB holds its hash.
    return res.status(201).json({ card: { id: card.id, ownerType: card.ownerType, status: card.status }, qrToken: token });
  })
);

router.post(
  "/:schoolId/cards/:cardId/revoke",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const card = await prisma.cardCredential.updateMany({
      where: { id: req.params.cardId, schoolId: req.params.schoolId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokeReason: req.body?.reason || "revoked" },
    });
    if (!card.count) return res.status(404).json({ error: "ACTIVE_CARD_NOT_FOUND" });
    return res.json({ ok: true });
  })
);

router.post(
  "/:schoolId/cards/:cardId/replace",
  requireAuth,
  requireSchool(WRITE),
  asyncRoute(async (req, res) => {
    const old = await prisma.cardCredential.findFirst({
      where: { id: req.params.cardId, schoolId: req.params.schoolId },
    });
    if (!old) return res.status(404).json({ error: "CARD_NOT_FOUND" });
    const token = randomToken();
    const [card] = await prisma.$transaction([
      prisma.cardCredential.update({
        where: { id: old.id },
        data: { status: "REPLACED", revokedAt: new Date(), revokeReason: req.body?.reason || "replaced" },
      }),
      prisma.cardCredential.create({
        data: {
          schoolId: old.schoolId,
          ownerType: old.ownerType,
          studentId: old.studentId,
          teacherProfileId: old.teacherProfileId,
          tokenHash: hashToken(token),
        },
      }),
    ]).then((r) => [r[1]]);
    return res.status(201).json({ card: { id: card.id, status: card.status }, qrToken: token });
  })
);

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

export default router;
