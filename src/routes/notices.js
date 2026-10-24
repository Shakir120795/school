import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { checkNoticePermission, resolveAudience } from "../services/notices.js";

const router = Router();
const SENDERS = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];
const READERS = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STAFF"];

// Audience preview — recipient count BEFORE anything is saved or sent.
router.post(
  "/schools/:schoolId/notices/preview",
  requireAuth,
  requireSchool(SENDERS),
  asyncRoute(async (req, res) => {
    const { audienceType, targets = [], audienceMeta } = req.body || {};
    if (!audienceType) return res.status(400).json({ error: "AUDIENCE_TYPE_REQUIRED" });
    const perm = await checkNoticePermission(req.params.schoolId, req.membership, audienceType, targets, audienceMeta);
    if (!perm.ok) return res.status(403).json({ error: perm.error });
    const recipients = await resolveAudience(req.params.schoolId, audienceType, targets, audienceMeta);
    return res.json({
      recipientCount: recipients.length,
      guardians: recipients.filter((r) => r.recipientType === "GUARDIAN").length,
      staff: recipients.filter((r) => r.recipientType !== "GUARDIAN").length,
    });
  })
);

router.post(
  "/schools/:schoolId/notices",
  requireAuth,
  requireSchool(SENDERS),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["title", "body", "audienceType"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const targets = req.body.targets || [];
    const perm = await checkNoticePermission(
      req.params.schoolId, req.membership, req.body.audienceType, targets, req.body.audienceMeta
    );
    if (!perm.ok) return res.status(403).json({ error: perm.error });
    const notice = await prisma.$transaction(async (tx) => {
      const n = await tx.notice.create({
        data: {
          schoolId: req.params.schoolId,
          senderMembershipId: req.membership.id,
          type: req.body.type || "ANNOUNCEMENT",
          priority: req.body.priority || "NORMAL",
          audienceType: req.body.audienceType,
          audienceMeta: req.body.audienceMeta || undefined,
          title: req.body.title,
          body: req.body.body,
          status: req.body.scheduledAt ? "SCHEDULED" : "DRAFT",
          scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
          requiresAck: !!req.body.requiresAck,
        },
      });
      if (targets.length) {
        await tx.noticeTarget.createMany({
          data: targets.map((t) => ({
            schoolId: req.params.schoolId,
            noticeId: n.id,
            classroomId: t.classroomId,
            studentId: t.studentId,
            guardianId: t.guardianId,
          })),
        });
      }
      return n;
    });
    return res.status(201).json({ notice });
  })
);

router.get(
  "/schools/:schoolId/notices",
  requireAuth,
  requireSchool(READERS),
  asyncRoute(async (req, res) => {
    const where = { schoolId: req.params.schoolId };
    if (req.membership.role === "TEACHER") where.senderMembershipId = req.membership.id;
    if (req.membership.role === "PARENT") where.status = { in: ["SENT", "SENDING"] };
    const notices = await prisma.notice.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return res.json({ notices });
  })
);

// Send: recipients are SNAPSHOTTED and the outbox event is written in the same
// transaction. A notice can be sent exactly once.
router.post(
  "/schools/:schoolId/notices/:noticeId/send",
  requireAuth,
  requireSchool(SENDERS),
  asyncRoute(async (req, res) => {
    const notice = await prisma.notice.findFirst({
      where: { id: req.params.noticeId, schoolId: req.params.schoolId },
      include: { targets: true },
    });
    if (!notice) return res.status(404).json({ error: "NOTICE_NOT_FOUND" });
    if (!["DRAFT", "SCHEDULED", "APPROVED"].includes(notice.status))
      return res.status(409).json({ error: "NOTICE_ALREADY_SENT_OR_CANCELLED", status: notice.status });
    if (req.membership.role === "TEACHER" && notice.senderMembershipId !== req.membership.id)
      return res.status(403).json({ error: "NOT_YOUR_NOTICE" });
    const perm = await checkNoticePermission(
      req.params.schoolId, req.membership, notice.audienceType, notice.targets, notice.audienceMeta
    );
    if (!perm.ok) return res.status(403).json({ error: perm.error });

    const recipients = await resolveAudience(
      req.params.schoolId, notice.audienceType, notice.targets, notice.audienceMeta
    );
    const result = await prisma.$transaction(async (tx) => {
      if (recipients.length) {
        await tx.noticeRecipient.createMany({
          data: recipients.map((r) => ({
            schoolId: req.params.schoolId,
            noticeId: notice.id,
            recipientType: r.recipientType,
            recipientRef: r.recipientRef,
          })),
          skipDuplicates: true,
        });
      }
      const updated = await tx.notice.update({
        where: { id: notice.id },
        data: { status: "SENDING", sentAt: new Date() },
      });
      await tx.notificationOutbox.create({
        data: {
          schoolId: req.params.schoolId,
          eventType: "notice.send",
          aggregateType: "Notice",
          aggregateId: notice.id,
          payload: { noticeId: notice.id, recipientCount: recipients.length },
          idempotencyKey: `notice:${notice.id}:send`,
        },
      });
      return updated;
    });
    return res.json({ notice: result, recipientCount: recipients.length });
  })
);

router.post(
  "/schools/:schoolId/notices/:noticeId/cancel",
  requireAuth,
  requireSchool(SENDERS),
  asyncRoute(async (req, res) => {
    const notice = await prisma.notice.updateMany({
      where: {
        id: req.params.noticeId,
        schoolId: req.params.schoolId,
        status: { in: ["DRAFT", "SCHEDULED", "APPROVAL_PENDING"] },
      },
      data: { status: "CANCELLED" },
    });
    if (!notice.count) return res.status(409).json({ error: "CANNOT_CANCEL" });
    return res.json({ ok: true });
  })
);

router.get(
  "/schools/:schoolId/notices/:noticeId/recipients",
  requireAuth,
  requireSchool(READERS),
  asyncRoute(async (req, res) => {
    const recipients = await prisma.noticeRecipient.findMany({
      where: { schoolId: req.params.schoolId, noticeId: req.params.noticeId },
      include: { deliveries: true },
    });
    return res.json({ recipients });
  })
);

// Parent acknowledgement of a notice addressed to one of their guardian profiles.
router.post(
  "/schools/:schoolId/notices/:noticeId/ack",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: req.params.schoolId, userId: req.user.id },
      select: { id: true },
    });
    const updated = await prisma.noticeRecipient.updateMany({
      where: {
        schoolId: req.params.schoolId,
        noticeId: req.params.noticeId,
        recipientType: "GUARDIAN",
        recipientRef: { in: guardians.map((g) => g.id) },
      },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });
    if (!updated.count) return res.status(404).json({ error: "NOT_A_RECIPIENT" });
    return res.json({ ok: true });
  })
);

export default router;
