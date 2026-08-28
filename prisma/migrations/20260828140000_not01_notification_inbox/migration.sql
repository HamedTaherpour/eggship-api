-- NOT-01: durable customer notification inbox persistence.
CREATE TYPE "NotificationType" AS ENUM ('ORDER_STATUS');
CREATE TYPE "NotificationSource" AS ENUM ('ORDER_TRANSITION', 'SYSTEM');

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "source" "NotificationSource" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_title_check" CHECK (char_length("title") BETWEEN 1 AND 160),
    CONSTRAINT "Notification_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "Notification_payload_check" CHECK (
      jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8192
    ),
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Notification_userId_createdAt_id_idx"
  ON "Notification"("userId", "createdAt", "id");
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx"
  ON "Notification"("userId", "readAt", "createdAt", "id");
