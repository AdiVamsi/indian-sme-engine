-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'APPOINTMENT_CREATED';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "leadId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_leadId_idx" ON "Appointment"("leadId");

-- AddForeignKey
ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
