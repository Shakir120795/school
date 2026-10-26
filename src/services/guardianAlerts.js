// Shared guardian alert helper: create a system notice addressed to one
// student's guardians and run it through the normal delivery pipeline
// (in-app inbox + push best-effort). Used by gate-scan alerts (Phase 11)
// and pickup release alerts (Phase 12). Never throws.
import { prisma } from "../db.js";
import { sendNoticeCore } from "./notices.js";
import { processOutboxOnce } from "./outbox.js";

export async function alertGuardians(schoolId, studentId, title, body) {
  try {
    const links = await prisma.studentGuardian.findMany({ where: { schoolId, studentId } });
    if (!links.length) return false;
    const sender =
      (await prisma.schoolMembership.findFirst({ where: { schoolId, role: "SCHOOL_ADMIN", status: "ACTIVE" } })) ||
      (await prisma.schoolMembership.findFirst({ where: { schoolId, role: "PRINCIPAL", status: "ACTIVE" } }));
    if (!sender) return false;
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
    await prisma.noticeTarget.create({ data: { schoolId, noticeId: notice.id, studentId } });
    await sendNoticeCore(schoolId, { ...notice, targets: [{ studentId }] });
    if (process.env.VERCEL) await processOutboxOnce().catch(() => {});
    return true;
  } catch (err) {
    console.error("[guardian-alert] failed:", err?.message || err);
    return false;
  }
}
