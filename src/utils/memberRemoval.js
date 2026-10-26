// Shared member-removal logic (Phase 23): used by BOTH the platform
// console (platform.js) and the school Team endpoints (schools.js).
// Removal is a SOFT removal: the membership goes INACTIVE (login
// only returns ACTIVE memberships and requireSchool demands ACTIVE,
// so access stops at once), an AuditLog row records reason + note +
// who + when, sessions are revoked, and a user left with no live
// membership anywhere is deactivated. No schema change was needed:
// MembershipStatus already has INACTIVE and AuditLog has metadata.
import { prisma } from "../db.js";

export const REMOVAL_REASONS = ["LEFT_SCHOOL", "RESIGNED", "DUPLICATE", "OTHER"];

export function parseRemoval(body) {
  const reason = body?.reason;
  const note = body?.note ? String(body.note).trim() : "";
  if (!REMOVAL_REASONS.includes(reason)) return { error: "REMOVAL_REASON_REQUIRED" };
  if (reason === "OTHER" && !note) return { error: "REMOVAL_NOTE_REQUIRED_FOR_OTHER" };
  return { reason, note: note || null };
}

export async function softRemoveMember({ schoolId, membership, actorUserId, reason, note }) {
  const member = await prisma.user.findUnique({
    where: { id: membership.userId },
    select: { fullName: true, email: true },
  });
  await prisma.schoolMembership.update({ where: { id: membership.id }, data: { status: "INACTIVE" } });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorUserId,
      action: "MEMBER_REMOVED",
      entityType: "SchoolMembership",
      entityId: membership.id,
      metadata: { reason, note, role: membership.role, memberName: member?.fullName || null, memberEmail: member?.email || null },
    },
  });
  const remaining = await prisma.schoolMembership.count({
    where: { userId: membership.userId, status: { not: "INACTIVE" } },
  });
  let userDeactivated = false;
  if (remaining === 0) {
    await prisma.authSession.updateMany({
      where: { userId: membership.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.user.update({ where: { id: membership.userId }, data: { isActive: false } });
    userDeactivated = true;
  }
  return { userDeactivated };
}

// Removed (INACTIVE) members of a school with their removal record.
export async function removedMembers(schoolId) {
  const rows = await prisma.schoolMembership.findMany({
    where: { schoolId, status: "INACTIVE" },
    include: { user: { select: { id: true, email: true, phone: true, fullName: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!rows.length) return [];
  const audits = await prisma.auditLog.findMany({
    where: { schoolId, action: "MEMBER_REMOVED", entityId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
  });
  const firstByEntity = {};
  for (const a of audits) if (!firstByEntity[a.entityId]) firstByEntity[a.entityId] = a;
  const actorIds = [...new Set(audits.map((a) => a.actorUserId).filter(Boolean))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
    : [];
  const actorName = Object.fromEntries(actors.map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    const a = firstByEntity[r.id];
    return {
      membershipId: r.id,
      userId: r.userId,
      role: r.role,
      fullName: r.user.fullName,
      email: r.user.email,
      phone: r.user.phone,
      reason: a?.metadata?.reason || null,
      note: a?.metadata?.note || null,
      removedBy: a ? actorName[a.actorUserId] || null : null,
      removedAt: a?.createdAt || r.updatedAt,
    };
  });
}
