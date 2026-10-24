// School analytics for role dashboards (Phase 7): today's attendance
// picture, headcounts, class-wise breakdown, pending work counters.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute } from "../utils/http.js";
import { localParts } from "../utils/time.js";

const router = Router();
const ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];

router.get(
  "/schools/:schoolId/analytics/today",
  requireAuth,
  requireSchool(ROLES),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const school = req.school;
    const today = localParts(new Date(), school.timezone).dateStr;
    const localDate = new Date(`${today}T00:00:00.000Z`);

    const [students, teachers, guardians, classrooms, stuRows, staffRows, notices7d, pendingCorrections] =
      await Promise.all([
        prisma.student.count({ where: { schoolId } }),
        prisma.teacherProfile.count({ where: { schoolId } }),
        prisma.guardian.count({ where: { schoolId } }),
        prisma.classroom.findMany({
          where: { schoolId },
          include: { _count: { select: { students: true } } },
          orderBy: [{ name: "asc" }, { section: "asc" }],
        }),
        prisma.studentAttendance.findMany({
          where: { schoolId, localDate },
          select: { status: true, reviewFlag: true, student: { select: { classroomId: true } } },
        }),
        prisma.staffAttendance.findMany({ where: { schoolId, localDate }, select: { status: true } }),
        prisma.notice.count({
          where: { schoolId, status: { in: ["SENT", "SENDING"] }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
        }),
        prisma.attendanceCorrectionRequest.count({ where: { schoolId, status: "PENDING" } }),
      ]);

    const tally = (rows) => {
      const t = { PRESENT: 0, LATE: 0, ABSENT: 0, other: 0 };
      for (const r of rows) (t[r.status] !== undefined ? (t[r.status] += 1) : (t.other += 1));
      return t;
    };
    const stu = tally(stuRows);
    const staff = tally(staffRows);

    let classBreakdown = classrooms.map((c) => {
      const rows = stuRows.filter((r) => r.student.classroomId === c.id);
      const t = tally(rows);
      return {
        id: c.id, name: c.name, section: c.section, total: c._count.students,
        present: t.PRESENT, late: t.LATE, absent: t.ABSENT, notMarked: c._count.students - rows.length,
      };
    });
    if (req.membership.role === "TEACHER") {
      const profile = await prisma.teacherProfile.findFirst({
        where: { schoolId, membershipId: req.membership.id },
        include: { classAssignments: true, inchargeAssignments: true },
      });
      const mine = new Set([
        ...(profile?.classAssignments || []).map((a) => a.classroomId),
        ...(profile?.inchargeAssignments || []).filter((i) => !i.effectiveTo || i.effectiveTo > new Date()).map((i) => i.classroomId),
      ]);
      classBreakdown = classBreakdown.filter((c) => mine.has(c.id));
    }

    return res.json({
      date: today,
      totals: { students, teachers, guardians, classes: classrooms.length },
      today: {
        present: stu.PRESENT, late: stu.LATE, absent: stu.ABSENT,
        marked: stuRows.length, notMarked: students - stuRows.length,
        attendancePct: students ? Math.round(((stu.PRESENT + stu.LATE) / students) * 100) : 0,
        staffPresent: staff.PRESENT + staff.LATE, staffMarked: staffRows.length,
        reviewFlags: stuRows.filter((r) => r.reviewFlag).length,
      },
      classes: classBreakdown,
      noticesSent7d: notices7d,
      pendingCorrections,
    });
  })
);

export default router;
