CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENROLLED',
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "capabilitiesJson" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "publicKeyFingerprint" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "sessionGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" DATETIME,
    "lastConnectedAt" DATETIME,
    "suspendedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AgentEnrollmentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'ENROLL',
    "agentId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEnrollmentToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "sessionGeneration" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "resultHash" TEXT,
    "errorCode" TEXT,
    CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTask_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Monitor" ADD COLUMN "agentId" TEXT REFERENCES "Agent"("id") ON DELETE SET NULL;
ALTER TABLE "Measurement" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "Measurement" ADD COLUMN "agentId" TEXT REFERENCES "Agent"("id") ON DELETE SET NULL;
ALTER TABLE "Measurement" ADD COLUMN "agentTaskId" TEXT REFERENCES "AgentTask"("id") ON DELETE SET NULL;
ALTER TABLE "Measurement" ADD COLUMN "agentStartedAt" DATETIME;

CREATE UNIQUE INDEX "AgentEnrollmentToken_tokenHash_key" ON "AgentEnrollmentToken"("tokenHash");
CREATE INDEX "AgentEnrollmentToken_expiresAt_usedAt_idx" ON "AgentEnrollmentToken"("expiresAt", "usedAt");
CREATE INDEX "Agent_status_lastHeartbeatAt_idx" ON "Agent"("status", "lastHeartbeatAt");
CREATE INDEX "AgentTask_agentId_status_expiresAt_idx" ON "AgentTask"("agentId", "status", "expiresAt");
CREATE INDEX "AgentTask_monitorId_status_idx" ON "AgentTask"("monitorId", "status");
CREATE INDEX "Monitor_agentId_idx" ON "Monitor"("agentId");
CREATE UNIQUE INDEX "Measurement_agentTaskId_key" ON "Measurement"("agentTaskId");
CREATE INDEX "Measurement_agentId_completedAt_idx" ON "Measurement"("agentId", "completedAt");
