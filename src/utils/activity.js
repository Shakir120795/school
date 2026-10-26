// Shared activity-log helpers (Phase 29 WS2): label mapping,
// pagination parsing and AuditLog row shaping for BOTH the operator
// endpoint (GET /platform/activity) and the school-scoped endpoint
// (GET /schools/:schoolId/activity). Single source of truth so the
// two views never drift.
//
// AuditLog rows today are written ONLY by utils/memberRemoval.js
// (action MEMBER_REMOVED, metadata { reason, note, role, memberName,
// memberEmail }). The label map also covers the other lifecycle
// actions named in the Phase 29 brief so any future writer is
// labelled nicely without a client change; anything unknown falls
// back to a prettified version of the raw code.
import { prisma } from "../db.js";

export const ACTION_LABELS = {
  MEMBER_REMOVED: "Member removed",
  MEMBER_ADDED: "Member added",
  MEMBER_CREATED: "Member added",
  MEMBER_UPDATED: "Member updated",
  MEMBER_EDITED: "Member updated",
  LOGIN: "Signed in",
  SCHOOL_CREATED: "School created",
  SCHOOL_SUSPENDED: "School suspended",
  SCHOOL_REACTIVATED: "School reactivated",
  SCHOOL_DELETED: "School deleted",
  PASSWORD_RESET: "Password reset",
  ADMIN_PASSWORD_RESET: "Admin password reset",
};

export function actionLabel(action) {
  const raw = String(action || "UNKNOWN");
  if (ACTION_LABELS[raw]) return ACTION_LABELS[raw];
  // Prettified fallback: MEMBER_FOO_BAR -> "Member foo bar".
  const words = raw.toLowerCase().split("_").filter(Boolean);
  if (!words.length) return raw;
  return words[0][0].toUpperCase() + words.join(" ").slice(1);
}

export function parsePagination(query) {
  let page = parseInt(query?.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  let pageSize = parseInt(query?.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
  if (pageSize > 100) pageSize = 100;
  return { page, pageSize };
}

// Human one-line summary of the stored metadata, for the UI's
// details line (reason / note / target member where present).
export function detailsText(row) {
  const m = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const parts = [];
  const target = m.memberName || m.targetName || m.fullName || null;
  const targetRole = m.role || m.targetRole || null;
  if (target) parts.push(targetRole ? `${target} (${targetRole})` : target);
  if (m.memberEmail) parts.push(m.memberEmail);
  if (m.reason) parts.push(`Reason: ${m.reason}`);
  if (m.note) parts.push(m.note);
  if (!parts.length && m.schoolName) parts.push(m.schoolName);
  return parts.length ? parts.join(" · ") : null;
}

export function shapeRow(row, actorInfo) {
  const m = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    label: actionLabel(row.action),
    actorUserId: row.actorUserId || null,
    actorName: actorInfo?.name || null,
    actorRole: actorInfo?.role || null,
    actorEmail: actorInfo?.email || null,
    schoolId: row.schoolId || null,
    schoolName: row.school?.name || null,
    entityType: row.entityType || null,
    entityId: row.entityId || null,
    metadata: m,
    details: {
      reason: m.reason || null,
      note: m.note || null,
      targetName: m.memberName || m.targetName || m.fullName || null,
      targetEmail: m.memberEmail || m.targetEmail || null,
      targetRole: m.role || m.targetRole || null,
    },
    detailsText: detailsText(row),
  };
}

// Fetch one page of AuditLog rows. `where` is pre-scoped by the
// caller (platform: optional schoolId; school: forced schoolId).
// Actor name/role resolution is batched: one User lookup + one
// membership lookup, never N+1. A platform operator actor is shown
// as PLATFORM_ADMIN; otherwise the actor's membership role IN THAT
// ROW'S SCHOOL (any status — a since-removed actor still resolves);
// rows with no school fall back to any membership of the actor.
export async function fetchActivityPage({ where, page, pageSize }) {
  const total = await prisma.auditLog.count({ where });
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      school: { select: { id: true, name: true } },
      actor: { select: { id: true, fullName: true, email: true, isPlatformAdmin: true } },
    },
  });

  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))];
  const memberships = actorIds.length
    ? await prisma.schoolMembership.findMany({
        where: { userId: { in: actorIds } },
        select: { userId: true, schoolId: true, role: true },
      })
    : [];
  const roleByKey = {}; // `${userId}|${schoolId}` -> role
  const anyRoleByUser = {}; // userId -> first role seen
  for (const ms of memberships) {
    roleByKey[`${ms.userId}|${ms.schoolId}`] = ms.role;
    if (!anyRoleByUser[ms.userId]) anyRoleByUser[ms.userId] = ms.role;
  }

  const items = rows.map((r) => {
    let actorInfo = null;
    if (r.actor) {
      const role = r.actor.isPlatformAdmin
        ? "PLATFORM_ADMIN"
        : (r.schoolId ? roleByKey[`${r.actor.id}|${r.schoolId}`] : null) || anyRoleByUser[r.actor.id] || null;
      actorInfo = { name: r.actor.fullName, email: r.actor.email, role };
    } else if (r.actorUserId) {
      actorInfo = { name: null, email: null, role: anyRoleByUser[r.actorUserId] || null };
    }
    return shapeRow(r, actorInfo);
  });

  // Distinct actions in scope (for filter dropdowns) — one grouped
  // query in parallel is avoided on purpose: pooler connection_limit=1
  // discipline in this codebase is sequential awaits outside tx.
  const distinct = await prisma.auditLog.findMany({
    where: (() => { const w = { ...where }; delete w.action; return w; })(),
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
  });
  const actions = distinct.map((d) => ({ action: d.action, label: actionLabel(d.action) }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    actions,
  };
}
