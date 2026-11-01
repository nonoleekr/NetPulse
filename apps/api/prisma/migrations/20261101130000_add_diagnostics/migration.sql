CREATE TABLE "DiagnosticRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "capability" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "DiagnosticRun_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DiagnosticRun_monitorId_startedAt_idx" ON "DiagnosticRun"("monitorId", "startedAt");
