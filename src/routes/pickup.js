// Pickup & safety (Phase 12, PDF §4).
// Standing authorised persons + one-time parent approvals + a staff
// release desk. Every release/rejection is logged and alerted to the
// child's guardians. A card scan alone never releases a child — a staff
// member performs this verification step.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { localParts } from "../utils/time.js";
import { alertGuardians } from "../services/guardianAlerts.js";

const router = Router();
const STAFF = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"];
const MANAGERS = ["SCHOOL_ADMIN", "PRINCIPAL"];
const ALL = [...STAFF, "PARENT"];

async function myGuardians(req, schoolId) {
  return prisma.guardian.findMany({ where: { schoolId, userId: req.user.id } });
}

// Returns "staff" | "parent" | null for this student.
async function accessFor(req, schoolId, studentId) {
  if (STAFF.includes(req.membership.role)) return "staff";
  if (req.membership.role === "PARENT") {
    const guardians = await myGuardians(req, schoolId);
    if (!guardians.length) return null;
    const link = await prisma.studentGuardian.findFirst({
      where: { schoolId, studentId, guardianId: { in: guardians.map((g) => g.id) } },
    });
    return link ? "parent" : null;
  }
  return null;
}

async function studentOr404(req, res, schoolId, studentId) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    include: { classroom: true },
  });
  if (!student) {
    res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    return null;
  }
  return student;
}

// --- Authorised persons -------------------------------------------------------
router.get(
  "/schools/:schoolId/students/:studentId/pickup-persons",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, studentId } = req.params;
    if (!(await accessFor(req, schoolId, studentId))) return res.status(404).json({ error: "NOT_FOUND" });
    const persons = await prisma.pickupPerson.findMany({
      where: { schoolId, studentId },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    });
    return res.json({ persons });
  })
);

router.post(
  "/schools/:schoolId/students/:studentId/pickup-persons",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, studentId } = req.params;
    const access = await accessFor(req, schoolId, studentId);
    if (!access) return res.status(404).json({ error: "NOT_FOUND" });
    if (access === "staff" && !MANAGERS.includes(req.membership.role) && req.membership.role !== "TEACHER") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    const missing = requireFields(req.body, ["fullName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    if (!(await studentOr404(req, res, schoolId, studentId))) return;
    let createdByGuardianId = null;
    if (access === "parent") {
      const guardians = await myGuardians(req, schoolId);
      createdByGuardianId = guardians[0]?.id || null;
    }
    const person = await prisma.pickupPerson.create({
      data: {
        schoolId, studentId,
        fullName: req.body.fullName,
        relationship: req.body.relationship,
        phone: req.body.phone,
        photoUrl: req.body.photoUrl,
        createdByGuardianId,
      },
    });
    return res.status(201).json({ person });
  })
);

router.patch(
  "/schools/:schoolId/pickup-persons/:personId",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, personId } = req.params;
    const person = await prisma.pickupPerson.findFirst({ where: { id: personId, schoolId } });
    if (!person) return res.status(404).json({ error: "NOT_FOUND" });
    if (!(await accessFor(req, schoolId, person.studentId))) return res.status(404).json({ error: "NOT_FOUND" });
    const updated = await prisma.pickupPerson.update({
      where: { id: personId },
      data: { isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : person.isActive },
    });
    return res.json({ person: updated });
  })
);

// --- One-time approvals ---------------------------------------------------------
router.post(
  "/schools/:schoolId/students/:studentId/pickup-approvals",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, studentId } = req.params;
    const access = await accessFor(req, schoolId, studentId);
    if (!access) return res.status(404).json({ error: "NOT_FOUND" });
    if (!req.body.pickupPersonId && !req.body.adhocName) {
      return res.status(400).json({ error: "PERSON_REQUIRED" });
    }
    if (req.body.pickupPersonId) {
      const person = await prisma.pickupPerson.findFirst({
        where: { id: req.body.pickupPersonId, schoolId, studentId, isActive: true },
      });
      if (!person) return res.status(400).json({ error: "PERSON_NOT_ACTIVE_OR_NOT_FOUND" });
    }
    const school = req.school;
    const validDate = req.body.validDate || localParts(new Date(), school.timezone).dateStr;
    let createdByGuardianId = null;
    if (access === "parent") {
      const guardians = await myGuardians(req, schoolId);
      createdByGuardianId = guardians[0]?.id || null;
    }
    const approval = await prisma.pickupApproval.create({
      data: {
        schoolId, studentId,
        pickupPersonId: req.body.pickupPersonId,
        adhocName: req.body.adhocName,
        adhocPhone: req.body.adhocPhone,
        validDate: new Date(`${validDate}T00:00:00.000Z`),
        createdByGuardianId,
      },
    });
    return res.status(201).json({ approval });
  })
);

router.patch(
  "/schools/:schoolId/pickup-approvals/:approvalId/cancel",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, approvalId } = req.params;
    const approval = await prisma.pickupApproval.findFirst({ where: { id: approvalId, schoolId } });
    if (!approval) return res.status(404).json({ error: "NOT_FOUND" });
    if (!(await accessFor(req, schoolId, approval.studentId))) return res.status(404).json({ error: "NOT_FOUND" });
    const updated = await prisma.pickupApproval.update({ where: { id: approvalId }, data: { status: "CANCELLED" } });
    return res.json({ approval: updated });
  })
);

// --- Gate desk: today's approvals + logs ---------------------------------------
router.get(
  "/schools/:schoolId/pickup/today",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const today = localParts(new Date(), req.school.timezone).dateStr;
    const approvals = await prisma.pickupApproval.findMany({
      where: { schoolId, validDate: new Date(`${today}T00:00:00.000Z`), status: "APPROVED" },
      include: { student: { select: { id: true, fullName: true, admissionNo: true, classroom: { select: { name: true, section: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    const personIds = approvals.map((a) => a.pickupPersonId).filter(Boolean);
    const persons = personIds.length
      ? await prisma.pickupPerson.findMany({ where: { id: { in: personIds }, schoolId } })
      : [];
    const byId = Object.fromEntries(persons.map((p) => [p.id, p]));
    const logs = await prisma.pickupLog.findMany({
      where: { schoolId, createdAt: { gte: new Date(`${today}T00:00:00.000Z`) } },
      include: { student: { select: { fullName: true, admissionNo: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({
      date: today,
      approvals: approvals.map((a) => ({ ...a, person: a.pickupPersonId ? byId[a.pickupPersonId] : null })),
      logs,
    });
  })
);

router.get(
  "/schools/:schoolId/students/:studentId/pickup-logs",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const { schoolId, studentId } = req.params;
    if (!(await accessFor(req, schoolId, studentId))) return res.status(404).json({ error: "NOT_FOUND" });
    const logs = await prisma.pickupLog.findMany({
      where: { schoolId, studentId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({ logs });
  })
);

// --- Release / reject -------------------------------------------------------------
router.post(
  "/schools/:schoolId/students/:studentId/release",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const { schoolId, studentId } = req.params;
    const student = await studentOr404(req, res, schoolId, studentId);
    if (!student) return;
    const outcome = req.body.outcome || "RELEASED";
    if (!["RELEASED", "REJECTED"].includes(outcome)) return res.status(400).json({ error: "INVALID_OUTCOME" });

    let personName = req.body.personName || null;
    let person = null;
    if (req.body.pickupPersonId) {
      person = await prisma.pickupPerson.findFirst({ where: { id: req.body.pickupPersonId, schoolId, studentId } });
      if (!person) return res.status(400).json({ error: "PERSON_NOT_FOUND" });
      personName = person.fullName;
    }
    let approval = null;
    if (req.body.approvalId) {
      approval = await prisma.pickupApproval.findFirst({ where: { id: req.body.approvalId, schoolId, studentId } });
      if (!approval) return res.status(400).json({ error: "APPROVAL_NOT_FOUND" });
      if (!personName) personName = approval.adhocName || person?.fullName || null;
      if (approval.pickupPersonId && !person) {
        person = await prisma.pickupPerson.findFirst({ where: { id: approval.pickupPersonId, schoolId } });
        if (person && !personName) personName = person.fullName;
      }
    }
    if (!personName) return res.status(400).json({ error: "PERSON_NAME_REQUIRED" });
    if (outcome === "RELEASED" && person && !person.isActive) {
      return res.status(400).json({ error: "PERSON_NOT_ACTIVE" });
    }

    const log = await prisma.pickupLog.create({
      data: {
        schoolId, studentId,
        pickupPersonId: person?.id || req.body.pickupPersonId || null,
        approvalId: approval?.id || null,
        personName,
        outcome,
        reason: req.body.reason,
        releasedByMembershipId: req.membership.id,
      },
    });
    if (approval && outcome === "RELEASED" && approval.status === "APPROVED") {
      await prisma.pickupApproval.update({ where: { id: approval.id }, data: { status: "USED" } });
    }
    const staffName = req.user.fullName;
    if (outcome === "RELEASED") {
      await alertGuardians(
        schoolId, studentId,
        `✅ ${student.fullName} collected from school`,
        `${student.fullName} was collected by ${personName}${person?.relationship ? ` (${person.relationship})` : ""}, verified and released by ${staffName} at the gate.`
      );
    } else {
      await alertGuardians(
        schoolId, studentId,
        `⚠️ Pickup attempt rejected for ${student.fullName}`,
        `A pickup attempt by ${personName} was rejected by ${staffName} at the gate.${req.body.reason ? ` Reason: ${req.body.reason}.` : ""} Your child remains at school.`
      );
    }
    return res.status(201).json({ log });
  })
);

export default router;
