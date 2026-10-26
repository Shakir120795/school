-- CreateEnum
CREATE TYPE "PickupApprovalStatus" AS ENUM ('APPROVED', 'USED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupOutcome" AS ENUM ('RELEASED', 'REJECTED');

-- CreateTable
CREATE TABLE "PickupPerson" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByGuardianId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupApproval" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pickupPersonId" TEXT,
    "adhocName" TEXT,
    "adhocPhone" TEXT,
    "validDate" DATE NOT NULL,
    "status" "PickupApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "createdByGuardianId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pickupPersonId" TEXT,
    "approvalId" TEXT,
    "personName" TEXT NOT NULL,
    "outcome" "PickupOutcome" NOT NULL,
    "reason" TEXT,
    "releasedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickupPerson_schoolId_studentId_idx" ON "PickupPerson"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "PickupApproval_schoolId_validDate_idx" ON "PickupApproval"("schoolId", "validDate");

-- CreateIndex
CREATE INDEX "PickupApproval_schoolId_studentId_idx" ON "PickupApproval"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "PickupLog_schoolId_createdAt_idx" ON "PickupLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PickupLog_schoolId_studentId_idx" ON "PickupLog"("schoolId", "studentId");

-- AddForeignKey
ALTER TABLE "PickupPerson" ADD CONSTRAINT "PickupPerson_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupPerson" ADD CONSTRAINT "PickupPerson_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupApproval" ADD CONSTRAINT "PickupApproval_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupApproval" ADD CONSTRAINT "PickupApproval_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupLog" ADD CONSTRAINT "PickupLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupLog" ADD CONSTRAINT "PickupLog_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
