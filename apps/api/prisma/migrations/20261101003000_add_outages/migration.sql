-- CreateTable
CREATE TABLE "Outage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "failureCount" INTEGER NOT NULL,
    "reason" TEXT,
    CONSTRAINT "Outage_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Outage_monitorId_startedAt_idx" ON "Outage"("monitorId", "startedAt");
