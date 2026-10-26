-- =====================================================================
-- PENDING LIVE SQL — run this ONE file once in the Supabase SQL Editor.
-- It contains everything the live database is currently missing:
--   Section 1: Phase 27 student family-detail columns (pending since
--              26 Oct 2026 — several list endpoints need these).
--   Section 2: Phase 29 WS8 platform billing tables (PlatformPlan +
--              SchoolSubscription) for the owner billing console.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS /
-- duplicate-object guards), so running it twice changes nothing.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Section 1 — Phase 27: Student family details (father / mother / address)
-- ---------------------------------------------------------------------
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "fatherName" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "motherName" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "address" TEXT;

-- ---------------------------------------------------------------------
-- Section 2 — Phase 29 WS8: platform billing (plans + school subscriptions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PlatformPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "features" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SchoolSubscription" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "paymentNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformPlan_isActive_idx" ON "PlatformPlan"("isActive");

CREATE INDEX IF NOT EXISTS "SchoolSubscription_schoolId_status_idx" ON "SchoolSubscription"("schoolId", "status");

CREATE INDEX IF NOT EXISTS "SchoolSubscription_planId_idx" ON "SchoolSubscription"("planId");

CREATE INDEX IF NOT EXISTS "SchoolSubscription_endsAt_idx" ON "SchoolSubscription"("endsAt");

-- Foreign keys have no IF NOT EXISTS form in Postgres — guard each
-- one so a re-run of this file does not error.
DO $$
BEGIN
    ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
