// Timetable + calendar (Phase 17, PDF §8/§22).
// Managers build each class's weekly grid; teachers also get a
// "my periods" view across classes; parents see their children's
// class grids. The calendar merges school events with the existing
// holiday list for a month.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { teacherClassIds } from "../services/teacherClasses.js";

const router = Router();
const STAFF = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"];
const MANAGERS = ["SCHOOL_ADMIN", "PRINCIPAL"];
const ALL = [...STAFF, "PARENT"];
const EVENT_TYPES = ["EVENT", "EXAM", "SPORTS", "CULTURAL", "PTM", "OTHER"];

function slotView(s) {
  return {
    ...s,
    subjectName: s.subject?.name || null,
    teacherName: s.teacherProfile?.displayName || null,
    display: s.label || s.subject?.name || "Period",
  };
}

async function loadSlots(schoolId, classroomId) {
  const slots = await prisma.timetableSlot.findMany({
    where: { schoolId, classroomId },
    include: { subject: true, teacherProfile: true },
    orderBy: [{ weekday: "asc" }, { periodNo: "asc" }],
  });
  return slots.map(slotView);
}

async function myChildrenClasses(req, schoolId) {
  const guardians = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
  if (!guardians.length) return [];
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
    include: { student: { select: { id: true, fullName: true, classroomId: true, classroom: { select: { name: true, section: true } } } } },
  });
  const byClass = new Map();
  for (const l of links) {
    if (!l.student.classroomId) continue;
    if (!byClass.has(l.student.classroomId)) {
      byClass.set(l.student.classroomId, {
        classroomId: l.student.classroomId,
        className: `${l.student.classroom?.name || ""}${l.student.classroom?.section ? "-" + l.student.classroom.section : ""}`,
        children: [],
      });
    }
    byClass.get(l.student.classroomId).children.push(l.student.fullName);
  }
  return [...byClass.values()];
}

// --- Class grid -------------------------------------------------------------------
router.get("/schools/:schoolId/timetable", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  if (req.membership.role === "PARENT") {
    const groups = await myChildrenClasses(req, schoolId);
    const out = [];
    for (const g of groups) out.push({ ...g, slots: await loadSlots(schoolId, g.classroomId) });
    return res.json({ classes: out });
  }
  const classroomId = req.query.classroomId;
  if (!classroomId) return res.status(400).json({ error: "CLASSROOM_REQUIRED" });
  if (req.membership.role === "TEACHER") {
    const ids = await teacherClassIds(schoolId, req.membership.id);
    if (!ids.includes(classroomId)) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
  }
  const classroom = await prisma.classroom.findFirst({ where: { id: classroomId, schoolId } });
  if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  return res.json({ classroom, slots: await loadSlots(schoolId, classroomId) });
}));

// Teacher's own periods across classes
router.get("/schools/:schoolId/timetable/mine", requireAuth, requireSchool(["TEACHER", ...MANAGERS]), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const profile = await prisma.teacherProfile.findFirst({ where: { schoolId, membershipId: req.membership.id } });
  if (!profile) return res.json({ slots: [] });
  const slots = await prisma.timetableSlot.findMany({
    where: { schoolId, teacherProfileId: profile.id },
    include: { subject: true, classroom: true },
    orderBy: [{ weekday: "asc" }, { periodNo: "asc" }],
  });
  return res.json({
    slots: slots.map((s) => ({
      ...slotView(s),
      className: `${s.classroom.name}${s.classroom.section ? "-" + s.classroom.section : ""}`,
    })),
  });
}));

router.post("/schools/:schoolId/timetable/slots", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["classroomId", "weekday", "periodNo", "startTime", "endTime"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const weekday = Number(req.body.weekday);
  const periodNo = Number(req.body.periodNo);
  if (!(weekday >= 1 && weekday <= 7) || !(periodNo >= 1 && periodNo <= 12)) {
    return res.status(400).json({ error: "INVALID_WEEKDAY_OR_PERIOD" });
  }
  const classroom = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
  if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  if (req.body.subjectId) {
    const subject = await prisma.subject.findFirst({ where: { id: req.body.subjectId, schoolId } });
    if (!subject) return res.status(400).json({ error: "SUBJECT_NOT_FOUND" });
  }
  if (req.body.teacherProfileId) {
    const tp = await prisma.teacherProfile.findFirst({ where: { id: req.body.teacherProfileId, schoolId } });
    if (!tp) return res.status(400).json({ error: "TEACHER_NOT_FOUND" });
  }
  const data = {
    startTime: req.body.startTime, endTime: req.body.endTime,
    subjectId: req.body.subjectId || null, label: req.body.label || null,
    teacherProfileId: req.body.teacherProfileId || null, room: req.body.room || null,
  };
  const slot = await prisma.timetableSlot.upsert({
    where: { schoolId_classroomId_weekday_periodNo: { schoolId, classroomId: classroom.id, weekday, periodNo } },
    create: { schoolId, classroomId: classroom.id, weekday, periodNo, ...data },
    update: data,
    include: { subject: true, teacherProfile: true },
  });
  return res.status(201).json({ slot: slotView(slot) });
}));

router.delete("/schools/:schoolId/timetable/slots/:slotId", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const { schoolId, slotId } = req.params;
  const slot = await prisma.timetableSlot.findFirst({ where: { id: slotId, schoolId } });
  if (!slot) return res.status(404).json({ error: "NOT_FOUND" });
  await prisma.timetableSlot.delete({ where: { id: slotId } });
  return res.json({ deleted: true });
}));

// --- Calendar ---------------------------------------------------------------------
router.get("/schools/:schoolId/calendar", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from.getTime() + 32 * 86400000);
  const [events, holidays] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { schoolId, eventDate: { gte: from, lt: to } }, orderBy: { eventDate: "asc" } }),
    prisma.holiday.findMany({ where: { schoolId, localDate: { gte: from, lt: to } }, orderBy: { localDate: "asc" } }),
  ]);
  return res.json({
    month,
    items: [
      ...events.map((e) => ({ kind: "EVENT", id: e.id, title: e.title, description: e.description, date: e.eventDate, endDate: e.endDate, type: e.type })),
      ...holidays.map((h) => ({ kind: "HOLIDAY", id: h.id, title: h.name, description: null, date: h.localDate, endDate: null, type: "HOLIDAY" })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)),
  });
}));

router.post("/schools/:schoolId/calendar/events", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["title", "eventDate"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const type = req.body.type || "EVENT";
  if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: "INVALID_TYPE" });
  const event = await prisma.calendarEvent.create({
    data: {
      schoolId, title: req.body.title, description: req.body.description,
      eventDate: new Date(`${String(req.body.eventDate).slice(0, 10)}T00:00:00.000Z`),
      endDate: req.body.endDate ? new Date(`${String(req.body.endDate).slice(0, 10)}T00:00:00.000Z`) : null,
      type, createdByMembershipId: req.membership.id,
    },
  });
  return res.status(201).json({ event });
}));

router.delete("/schools/:schoolId/calendar/events/:eventId", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const { schoolId, eventId } = req.params;
  const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, schoolId } });
  if (!event) return res.status(404).json({ error: "NOT_FOUND" });
  await prisma.calendarEvent.delete({ where: { id: eventId } });
  return res.json({ deleted: true });
}));

export default router;
