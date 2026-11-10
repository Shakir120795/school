// Support tickets + PTM bookings (Phase 20, PDF §17/§23/§30).
// Tickets: a parent raises a query about their child; the office
// replies in a thread; staff replies alert the child's guardians.
// PTM: the school opens a meeting window; parents book one start
// time per child; a start time cannot be double-booked in a PTM.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { alertGuardians } from "../services/guardianAlerts.js";

const router = Router();
const STAFF = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"];
const MANAGERS = ["SCHOOL_ADMIN", "PRINCIPAL"];
const ALL = [...STAFF, "PARENT"];
const CATEGORIES = ["GENERAL", "FEES", "TRANSPORT", "ACADEMIC", "OTHER"];
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const isStaffRole = (r) => STAFF.includes(r);

async function authorNameOf(req) {
  if (req._authorName) return req._authorName;
  const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fullName: true, email: true } });
  req._authorName = u?.fullName || u?.email || "User";
  return req._authorName;
}

async function myGuardianIds(req, schoolId) {
  const gs = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
  return gs.map((g) => g.id);
}
async function ownsChild(req, schoolId, studentId) {
  const ids = await myGuardianIds(req, schoolId);
  if (!ids.length) return false;
  const link = await prisma.studentGuardian.findFirst({ where: { schoolId, studentId, guardianId: { in: ids } } });
  return !!link;
}
// Phase 51: ticket ke saath student ki poori pehchan — sirf naam
// nahi, uski CLASS aur CLASS TEACHER (incharge) bhi, taaki office
// ko turant pata chale complaint kis bacche ki hai aur uski class
// kiske paas hai (shakir: 'only student name or parent name hi
// likha aa rha h, class nhi aa rhi, class teacher kon h ye bhi nhi').
async function studentBriefs(schoolId, studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const students = await prisma.student.findMany({
    where: { schoolId, id: { in: ids } },
    select: { id: true, fullName: true, classroomId: true, classroom: { select: { name: true, section: true } } },
  });
  const classIds = [...new Set(students.map((s) => s.classroomId).filter(Boolean))];
  const incharges = classIds.length
    ? await prisma.classInchargeAssignment.findMany({
        where: { schoolId, classroomId: { in: classIds }, effectiveTo: null },
        select: { classroomId: true, teacher: { select: { displayName: true } } },
      })
    : [];
  const teacherOf = Object.fromEntries(incharges.map((i) => [i.classroomId, i.teacher?.displayName || null]));
  const out = {};
  for (const s of students) {
    out[s.id] = {
      studentName: s.fullName,
      studentClass: s.classroom ? `Class ${s.classroom.name}${s.classroom.section ? "-" + s.classroom.section : ""}` : null,
      classTeacher: s.classroomId ? teacherOf[s.classroomId] || null : null,
    };
  }
  return out;
}
const NO_STUDENT = { studentName: null, studentClass: null, classTeacher: null };

// Phase 52: ticket routing. A TEACHER-audience ticket is addressed to
// the incharge of the student's class; that teacher alone sees it in
// her queue (plus managers, who see everything).
async function teacherInchargeClassIds(schoolId, membershipId) {
  const profile = await prisma.teacherProfile.findFirst({ where: { schoolId, membershipId }, select: { id: true } });
  if (!profile) return [];
  const rows = await prisma.classInchargeAssignment.findMany({
    where: { schoolId, teacherId: profile.id, effectiveTo: null },
    select: { classroomId: true },
  });
  return rows.map((r) => r.classroomId);
}

async function studentIdsOfClasses(schoolId, classroomIds) {
  if (!classroomIds.length) return [];
  const rows = await prisma.student.findMany({
    where: { schoolId, classroomId: { in: classroomIds }, status: "ACTIVE" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Class teacher (incharge name) of one student, or null.
async function classTeacherOfStudent(schoolId, studentId) {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { classroomId: true } });
  if (!student?.classroomId) return null;
  const assignment = await prisma.classInchargeAssignment.findFirst({
    where: { schoolId, classroomId: student.classroomId, effectiveTo: null },
    include: { teacher: { select: { displayName: true } } },
  });
  return assignment?.teacher?.displayName || null;
}

async function ticketAccess(req, schoolId, ticketId) {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, schoolId } });
  if (!ticket) return null;
  const role = req.membership.role;
  if (role === "PARENT") return ticket.raisedByUserId === req.user.id ? ticket : null;
  if (role === "SCHOOL_ADMIN" || role === "PRINCIPAL") return ticket; // managers see everything
  if (role === "TEACHER") {
    // Phase 52: a teacher opens only TEACHER tickets of students in
    // classes she is incharge of.
    if (ticket.audience !== "TEACHER" || !ticket.studentId) return null;
    const classIds = await teacherInchargeClassIds(schoolId, req.membership.id);
    if (!classIds.length) return null;
    const student = await prisma.student.findFirst({
      where: { id: ticket.studentId, schoolId },
      select: { classroomId: true },
    });
    return student?.classroomId && classIds.includes(student.classroomId) ? ticket : null;
  }
  // STAFF (office team): the office queue only.
  return ticket.audience !== "TEACHER" ? ticket : null;
}

// --- Tickets ----------------------------------------------------------------------
router.post("/schools/:schoolId/tickets", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["subject", "body"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const category = req.body.category || "GENERAL";
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "INVALID_CATEGORY" });
  let studentId = req.body.studentId || null;
  // Phase 51: parent ki ticket kisi bacche ke baare me hi hogi —
  // bina child chune ticket nahi banegi (form me 'About child'
  // chunna zaroori hai). Staff ke liye student ab bhi optional
  // hai (General ticket ban sakti hai).
  if (req.membership.role === "PARENT" && !studentId) {
    return res.status(400).json({ error: "STUDENT_REQUIRED" });
  }
  if (studentId) {
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    if (req.membership.role === "PARENT" && !(await ownsChild(req, schoolId, studentId))) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
  }
  // Phase 52: parent chun sakta hai ticket kisko jaye — School
  // Office ya uske bacche ki Class Teacher (jaise leave ki baat
  // teacher ko, fees ki baat office ko). Teacher wali ticket ke
  // liye student hona aur uski class ka incharge hona zaroori hai.
  const audience = req.body.audience === "TEACHER" ? "TEACHER" : "OFFICE";
  if (audience === "TEACHER") {
    if (!studentId) return res.status(400).json({ error: "STUDENT_REQUIRED" });
    const teacherName = await classTeacherOfStudent(schoolId, studentId);
    if (!teacherName) return res.status(400).json({ error: "NO_CLASS_TEACHER" });
  }
  // Resolve the author name BEFORE the transaction: on the hosted
  // pooler the client has connection_limit=1, so any global-client
  // query inside the tx callback deadlocks against the tx itself.
  const authorName = await authorNameOf(req);
  const ticket = await prisma.$transaction(async (tx) => {
    const count = await tx.supportTicket.count({ where: { schoolId } });
    const t = await tx.supportTicket.create({
      data: {
        schoolId, ticketNo: count + 1,
        raisedByUserId: req.user.id, raisedByMembershipId: req.membership.id,
        studentId, category, subject: req.body.subject, audience,
      },
    });
    await tx.ticketMessage.create({
      data: {
        schoolId, ticketId: t.id, authorUserId: req.user.id, authorMembershipId: req.membership.id,
        authorName, isStaff: isStaffRole(req.membership.role), body: req.body.body,
      },
    });
    return t;
  });
  return res.status(201).json({ ticket });
}));

router.get("/schools/:schoolId/tickets", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const where = { schoolId };
  const role = req.membership.role;
  if (role === "PARENT") {
    where.raisedByUserId = req.user.id;
  } else if (role === "TEACHER") {
    // Phase 52: teacher ki queue = uski incharge classes ke baccho
    // ki TEACHER tickets hi.
    const classIds = await teacherInchargeClassIds(schoolId, req.membership.id);
    const ids = await studentIdsOfClasses(schoolId, classIds);
    where.audience = "TEACHER";
    where.studentId = { in: ids };
  } else if (role === "STAFF") {
    where.audience = "OFFICE"; // office team: office queue only
  }
  if (req.query.status && STATUSES.includes(req.query.status)) where.status = req.query.status;
  const tickets = await prisma.supportTicket.findMany({
    where, orderBy: { updatedAt: "desc" }, take: 100,
  });
  const briefs = await studentBriefs(schoolId, tickets.map((t) => t.studentId));
  return res.json({ tickets: tickets.map((t) => ({ ...t, ...NO_STUDENT, ...(t.studentId ? briefs[t.studentId] || {} : {}) })) });
}));

router.get("/schools/:schoolId/tickets/:ticketId", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const { schoolId, ticketId } = req.params;
  const ticket = await ticketAccess(req, schoolId, ticketId);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND" });
  const messages = await prisma.ticketMessage.findMany({
    where: { schoolId, ticketId }, orderBy: { createdAt: "asc" }, take: 200,
  });
  const briefs = await studentBriefs(schoolId, [ticket.studentId]);
  return res.json({ ticket: { ...ticket, ...NO_STUDENT, ...(ticket.studentId ? briefs[ticket.studentId] || {} : {}) }, messages });
}));

router.post("/schools/:schoolId/tickets/:ticketId/messages", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const { schoolId, ticketId } = req.params;
  const ticket = await ticketAccess(req, schoolId, ticketId);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND" });
  if (ticket.status === "CLOSED") return res.status(409).json({ error: "TICKET_CLOSED" });
  if (!req.body?.body) return res.status(400).json({ error: "BODY_REQUIRED" });
  const staff = isStaffRole(req.membership.role);
  const message = await prisma.ticketMessage.create({
    data: {
      schoolId, ticketId, authorUserId: req.user.id, authorMembershipId: req.membership.id,
      authorName: await authorNameOf(req), isStaff: staff, body: req.body.body,
    },
  });
  const patch = {};
  if (staff && ticket.status === "OPEN") patch.status = "IN_PROGRESS";
  if (!staff && ticket.status === "RESOLVED") patch.status = "IN_PROGRESS"; // parent reopens by replying
  if (Object.keys(patch).length) await prisma.supportTicket.update({ where: { id: ticketId }, data: patch });
  else await prisma.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  if (staff && ticket.studentId) {
    await alertGuardians(schoolId, ticket.studentId,
      `🎫 Reply on your ticket #${ticket.ticketNo}`,
      `${ticket.subject} — the school has replied. Open Support in the app to read and respond.`);
  }
  return res.status(201).json({ message });
}));

router.patch("/schools/:schoolId/tickets/:ticketId/status", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const { schoolId, ticketId } = req.params;
  const ticket = await ticketAccess(req, schoolId, ticketId);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND" });
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
  if (!isStaffRole(req.membership.role) && status !== "CLOSED") {
    return res.status(403).json({ error: "PARENTS_CAN_ONLY_CLOSE" });
  }
  const updated = await prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  return res.json({ ticket: updated });
}));

// --- PTM ----------------------------------------------------------------------------
function timeToMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function minToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function slotTimes(slot) {
  const start = timeToMin(slot.startTime);
  const end = timeToMin(slot.endTime);
  if (start === null || end === null || end <= start) return [];
  const out = [];
  for (let t = start; t < end; t += slot.slotMinutes) out.push(minToTime(t));
  return out;
}

router.post("/schools/:schoolId/ptm", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["title", "date", "startTime", "endTime"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  if (timeToMin(req.body.startTime) === null || timeToMin(req.body.endTime) === null || timeToMin(req.body.endTime) <= timeToMin(req.body.startTime)) {
    return res.status(400).json({ error: "INVALID_TIME_WINDOW" });
  }
  if (req.body.classroomId) {
    const cls = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
    if (!cls) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  }
  const slot = await prisma.ptmSlot.create({
    data: {
      schoolId, title: req.body.title,
      date: new Date(`${String(req.body.date).slice(0, 10)}T00:00:00.000Z`),
      startTime: req.body.startTime, endTime: req.body.endTime,
      slotMinutes: Math.min(120, Math.max(5, Number(req.body.slotMinutes) || 15)),
      classroomId: req.body.classroomId || null,
      createdByMembershipId: req.membership.id,
    },
  });
  return res.status(201).json({ slot });
}));

router.get("/schools/:schoolId/ptm", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const slots = await prisma.ptmSlot.findMany({
    where: { schoolId, date: { gte: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z") } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 100,
  });
  let myBookings = [];
  if (req.membership.role === "PARENT") {
    myBookings = await prisma.ptmBooking.findMany({
      where: { schoolId, bookedByUserId: req.user.id, status: "BOOKED" },
      include: { student: { select: { fullName: true } } },
    });
  }
  const bookings = await prisma.ptmBooking.findMany({
    where: { schoolId, slotId: { in: slots.map((s) => s.id) }, status: "BOOKED" },
    select: { slotId: true, startTime: true },
  });
  const taken = {};
  for (const b of bookings) (taken[b.slotId] ||= []).push(b.startTime);
  const myBySlot = {};
  for (const b of myBookings) (myBySlot[b.slotId] ||= []).push({ id: b.id, studentId: b.studentId, studentName: b.student.fullName, startTime: b.startTime });
  return res.json({
    slots: slots.map((s) => ({
      ...s, times: slotTimes(s), takenTimes: taken[s.id] || [], myBookings: myBySlot[s.id] || [],
    })),
  });
}));

router.post("/schools/:schoolId/ptm/:slotId/book", requireAuth, requireSchool(["PARENT"]), asyncRoute(async (req, res) => {
  const { schoolId, slotId } = req.params;
  const slot = await prisma.ptmSlot.findFirst({ where: { id: slotId, schoolId } });
  if (!slot) return res.status(404).json({ error: "NOT_FOUND" });
  const { studentId, startTime } = req.body || {};
  if (!studentId || !startTime) return res.status(400).json({ error: "STUDENT_AND_TIME_REQUIRED" });
  if (!(await ownsChild(req, schoolId, studentId))) return res.status(404).json({ error: "NOT_FOUND" });
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (slot.classroomId && student.classroomId !== slot.classroomId) {
    return res.status(400).json({ error: "PTM_IS_FOR_ANOTHER_CLASS" });
  }
  if (!slotTimes(slot).includes(startTime)) return res.status(400).json({ error: "TIME_OUTSIDE_WINDOW" });
  const mine = await prisma.ptmBooking.findFirst({ where: { schoolId, slotId, studentId, status: "BOOKED" } });
  if (mine) return res.status(409).json({ error: "ALREADY_BOOKED_FOR_THIS_CHILD" });
  const taken = await prisma.ptmBooking.findFirst({ where: { schoolId, slotId, startTime, status: "BOOKED" } });
  if (taken) return res.status(409).json({ error: "TIME_TAKEN" });
  const booking = await prisma.ptmBooking.create({
    data: { schoolId, slotId, studentId, bookedByUserId: req.user.id, startTime },
  });
  await alertGuardians(schoolId, studentId,
    `👨‍👩‍👧 PTM booked: ${slot.title}`,
    `Your meeting for ${student.fullName} is booked on ${slot.date.toISOString().slice(0, 10)} at ${startTime}.`);
  return res.status(201).json({ booking });
}));

router.delete("/schools/:schoolId/ptm/bookings/:bookingId", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const { schoolId, bookingId } = req.params;
  const booking = await prisma.ptmBooking.findFirst({ where: { id: bookingId, schoolId } });
  if (!booking) return res.status(404).json({ error: "NOT_FOUND" });
  if (req.membership.role === "PARENT" && booking.bookedByUserId !== req.user.id) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  await prisma.ptmBooking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
  return res.json({ cancelled: true });
}));

router.delete("/schools/:schoolId/ptm/:slotId", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const { schoolId, slotId } = req.params;
  const slot = await prisma.ptmSlot.findFirst({ where: { id: slotId, schoolId } });
  if (!slot) return res.status(404).json({ error: "NOT_FOUND" });
  await prisma.ptmSlot.delete({ where: { id: slotId } });
  return res.json({ deleted: true });
}));

export default router;
