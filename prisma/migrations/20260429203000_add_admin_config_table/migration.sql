CREATE TABLE IF NOT EXISTS "AdminConfig" (
    "id" TEXT NOT NULL,
    "notificationMobile" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AdminConfig" ("id", "notificationMobile")
VALUES ('default', '')
ON CONFLICT ("id") DO NOTHING;
