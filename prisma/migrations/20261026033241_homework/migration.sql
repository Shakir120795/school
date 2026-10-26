-- CreateTable
CREATE TABLE "Homework" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE NOT NULL,
    "attachmentUrl" TEXT,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkCompletion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT,
    "markedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Homework_schoolId_classroomId_dueDate_idx" ON "Homework"("schoolId", "classroomId", "dueDate");

-- CreateIndex
CREATE INDEX "HomeworkCompletion_schoolId_studentId_idx" ON "HomeworkCompletion"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkCompletion_homeworkId_studentId_key" ON "HomeworkCompletion"("homeworkId", "studentId");

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_classroomId_fkey" FOREIGN KEY ("schoolId", "classroomId") REFERENCES "Classroom"("schoolId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkCompletion" ADD CONSTRAINT "HomeworkCompletion_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkCompletion" ADD CONSTRAINT "HomeworkCompletion_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
