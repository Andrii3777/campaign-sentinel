-- CreateEnum
CREATE TYPE "InvestigationMode" AS ENUM ('DEMO', 'URL');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('REQUESTED', 'REJECTED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "conversionEvent" TEXT NOT NULL,
    "scenarioKey" TEXT,
    "dataStart" DATE NOT NULL,
    "dataEnd" DATE NOT NULL,
    "defaultBaselineStart" DATE NOT NULL,
    "defaultBaselineEnd" DATE NOT NULL,
    "defaultCurrentStart" DATE NOT NULL,
    "defaultCurrentEnd" DATE NOT NULL,
    "simulatedFaults" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "sessions" INTEGER NOT NULL,
    "trackedConversions" INTEGER NOT NULL,
    "backendConversions" INTEGER NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEventDaily" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "device" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "FunnelEventDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageCheck" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "device" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseMs" INTEGER NOT NULL,
    "deployVersion" TEXT NOT NULL,

    CONSTRAINT "LandingPageCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageSnapshot" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "deployVersion" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "html" TEXT NOT NULL,

    CONSTRAINT "LandingPageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLogEntry" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT,

    CONSTRAINT "ChangeLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "mode" "InvestigationMode" NOT NULL,
    "campaignId" TEXT,
    "targetUrl" TEXT,
    "question" TEXT NOT NULL,
    "baselineStart" DATE,
    "baselineEnd" DATE,
    "currentStart" DATE,
    "currentEnd" DATE,
    "source" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "clientName" TEXT,
    "clientVersion" TEXT,
    "clientUserAgent" TEXT,
    "model" TEXT,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'QUEUED',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT,
    "retryOfId" TEXT,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "modelTurns" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "reportAttempts" INTEGER NOT NULL DEFAULT 0,
    "httpRequests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "lastEvidenceNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationEvent" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "InvestigationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "callerRef" TEXT,
    "input" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ToolExecutionStatus" NOT NULL DEFAULT 'REQUESTED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "output" JSONB,
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "toolExecutionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "provenance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "investigationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1',
    "verdict" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("investigationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_campaignId_date_source_device_key" ON "DailyMetric"("campaignId", "date", "source", "device");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEventDaily_campaignId_date_device_eventName_key" ON "FunnelEventDaily"("campaignId", "date", "device", "eventName");

-- CreateIndex
CREATE INDEX "LandingPageCheck_campaignId_checkedAt_idx" ON "LandingPageCheck"("campaignId", "checkedAt");

-- CreateIndex
CREATE INDEX "LandingPageSnapshot_campaignId_capturedAt_idx" ON "LandingPageSnapshot"("campaignId", "capturedAt");

-- CreateIndex
CREATE INDEX "ChangeLogEntry_campaignId_at_idx" ON "ChangeLogEntry"("campaignId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_idempotencyKey_key" ON "Investigation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Investigation_createdAt_idx" ON "Investigation"("createdAt");

-- CreateIndex
CREATE INDEX "Investigation_status_lastActivityAt_idx" ON "Investigation"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvestigationEvent_investigationId_seq_key" ON "InvestigationEvent"("investigationId", "seq");

-- CreateIndex
CREATE INDEX "ToolExecution_investigationId_createdAt_idx" ON "ToolExecution"("investigationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_investigationId_callerRef_key" ON "ToolExecution"("investigationId", "callerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_investigationId_ref_key" ON "Evidence"("investigationId", "ref");

-- AddForeignKey
ALTER TABLE "DailyMetric" ADD CONSTRAINT "DailyMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEventDaily" ADD CONSTRAINT "FunnelEventDaily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageCheck" ADD CONSTRAINT "LandingPageCheck_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageSnapshot" ADD CONSTRAINT "LandingPageSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLogEntry" ADD CONSTRAINT "ChangeLogEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "Investigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationEvent" ADD CONSTRAINT "InvestigationEvent_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_toolExecutionId_fkey" FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
