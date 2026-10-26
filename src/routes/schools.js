import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool, ADMIN_ROLES } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { hashPassword, randomToken, hashToken } from "../utils/security.js";
import { normalizePhone } from "../services/otp.js";
import { parseRemoval, softRemoveMember, removedMembers } from "../utils/memberRemoval.js";

const router = Router();
const WRITE = ADMIN_ROLES;
const READ = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STAFF"];

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
    return res.json({ memberships });
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
    const students = await prisma.student.findMany({ where, orderBy: { fullName: "asc" } });
    return res.json({ students });
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
