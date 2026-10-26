// Scan → parent alerts (Phase 11, PDF §2): when a student's card scan is
// RECORDED at the gate, their guardians get an in-app notification
// ("entered school" / "left school") through the normal notice pipeline —
// same inbox, same delivery tracking, push as best-effort extra.
// Alert failures NEVER fail the scan itself.
import { prisma } from "../db.js";
import { sendNoticeCore } from "./notices.js";
import { processOutboxOnce } from "./outbox.js";

export async function alertGuardiansForScan({ schoolId, studentId, eventType, scannedAt }) {
  try {
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId },
      include: { classroom: true, school: true },
    });
    if (!student) return;
    const links = await prisma.studentGuardian.findMany({ where: { schoolId, studentId } });
    if (!links.length) return; // no guardians linked — nobody to alert

    // System notices need a sender: use the school's admin membership
    // (fall back to principal). The title/body make the automatic
    // nature of the alert explicit.
    const sender =
      (await prisma.schoolMembership.findFirst({ where: { schoolId, role: "SCHOOL_ADMIN", status: "ACTIVE" } })) ||
      (await prisma.schoolMembership.findFirst({ where: { schoolId, role: "PRINCIPAL", status: "ACTIVE" } }));
    if (!sender) return;

    const tz = student.school.timezone;
    const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(scannedAt);
    const entered = eventType === "ENTRY";
    const title = entered
      ? `🟢 ${student.fullName} entered school`
      : `🔵 ${student.fullName} left school`;
    const body =
      `${student.fullName} (Class ${student.classroom?.name || "-"}${student.classroom?.section ? "-" + student.classroom.section : ""}) ` +
      `${entered ? "entered" : "left"} school at ${time}. This is an automatic gate-scan alert.`;

    const notice = await prisma.notice.create({
      data: {
        schoolId,
        senderMembershipId: sender.id,
        type: "ANNOUNCEMENT",
        audienceType: "SELECTED_STUDENTS",
        title,
        body,
      },
    });
    // NoticeTarget has a composite FK, so the row is created separately
    // (same pattern as the notices route).
    await prisma.noticeTarget.create({ data: { schoolId, noticeId: notice.id, studentId } });
    await sendNoticeCore(schoolId, { ...notice, targets: [{ studentId }] });
    if (process.env.VERCEL) {
      // Serverless: no long-running worker, deliver inline.
      await processOutboxOnce().catch(() => {});
    }
  } catch (err) {
    console.error("[scan-alert] failed (scan unaffected):", err?.message || err);
  }
}
