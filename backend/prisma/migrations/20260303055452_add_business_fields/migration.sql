-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('AGENT_CLASSIFIED', 'AGENT_PRIORITIZED', 'FOLLOW_UP_SCHEDULED', 'SLA_ALERT');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "currency" TEXT DEFAULT 'INR',
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "timezone" TEXT DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "toneStyle" TEXT NOT NULL DEFAULT 'professional',
    "priorityRules" JSONB NOT NULL,
    "classificationRules" JSONB NOT NULL,
    "followUpMinutes" INTEGER NOT NULL DEFAULT 30,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfig_businessId_key" ON "AgentConfig"("businessId");

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
