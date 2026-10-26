// Scan → parent alerts (Phase 11, PDF §2): a RECORDED student gate scan
// notifies the child's guardians in-app ("entered school" / "left
// school"). Built on the shared guardian alert helper (Phase 12).
import { prisma } from "../db.js";
import { alertGuardians } from "./guardianAlerts.js";

export async function alertGuardiansForScan({ schoolId, studentId, eventType, scannedAt }) {
  try {
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId },
      include: { classroom: true, school: true },
    });
    if (!student) return;
    const tz = student.school.timezone;
    const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(scannedAt);
    const entered = eventType === "ENTRY";
    const title = entered
      ? `🟢 ${student.fullName} entered school`
      : `🔵 ${student.fullName} left school`;
    const body =
      `${student.fullName} (Class ${student.classroom?.name || "-"}${student.classroom?.section ? "-" + student.classroom.section : ""}) ` +
      `${entered ? "entered" : "left"} school at ${time}. This is an automatic gate-scan alert.`;
    await alertGuardians(schoolId, studentId, title, body);
  } catch (err) {
    console.error("[scan-alert] failed (scan unaffected):", err?.message || err);
  }
}
