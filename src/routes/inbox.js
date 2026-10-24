// In-app notification inbox — the primary delivery channel (the school
// runs on the app; WhatsApp/push are optional extras). Every notice a user
// receives appears here with read state.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute } from "../utils/http.js";

const router = Router();
const ANY_MEMBER = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STAFF"];

/** Recipient refs that belong to the signed-in user in this school. */
async function myRecipientRefs(req) {
  const refs = [{ recipientType: { in: ["TEACHER", "STAFF"] }, recipientRef: req.membership.id }];
  const guardians = await prisma.guardian.findMany({
    where: { schoolId: req.params.schoolId, userId: req.user.id },
    select: { id: true },
  });
  if (guardians.length) {
    refs.push({ recipientType: "GUARDIAN", recipientRef: { in: guardians.map((g) => g.id) } });
  }
  return refs;
}

router.get(
  "/schools/:schoolId/my-notifications",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const refs = await myRecipientRefs(req);
    const where = { schoolId: req.params.schoolId, OR: refs };
    const [items, unread] = await Promise.all([
      prisma.noticeRecipient.findMany({
        where,
        include: { notice: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.noticeRecipient.count({ where: { ...where, acknowledgedAt: null } }),
    ]);
    return res.json({
      unread,
      notifications: items.map((r) => ({
        recipientId: r.id,
        status: r.status,
        read: !!r.acknowledgedAt,
        acknowledgedAt: r.acknowledgedAt,
        receivedAt: r.createdAt,
        notice: {
          id: r.notice.id,
          title: r.notice.title,
          body: r.notice.body,
          type: r.notice.type,
          priority: r.notice.priority,
          createdAt: r.notice.createdAt,
        },
      })),
    });
  })
);

router.post(
  "/schools/:schoolId/my-notifications/:recipientId/read",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const refs = await myRecipientRefs(req);
    const row = await prisma.noticeRecipient.findFirst({
      where: { id: req.params.recipientId, schoolId: req.params.schoolId, OR: refs },
    });
    if (!row) return res.status(404).json({ error: "NOTIFICATION_NOT_FOUND" });
    const updated = await prisma.noticeRecipient.update({
      where: { id: row.id },
      data: { acknowledgedAt: row.acknowledgedAt || new Date(), status: "ACKNOWLEDGED" },
    });
    return res.json({ notification: { recipientId: updated.id, read: true, acknowledgedAt: updated.acknowledgedAt } });
  })
);

export default router;
