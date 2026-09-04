-- NOT-04: provider-neutral push installations and durable delivery state.
CREATE TYPE "PushInstallationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'INVALIDATED');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WEB_PUSH');
CREATE TYPE "NotificationDeliveryState" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'INVALIDATED', 'SUPPRESSED');
CREATE TYPE "NotificationDeliveryFailureCode" AS ENUM ('INVALID_TOKEN', 'TRANSIENT', 'RATE_LIMITED', 'PROVIDER_CONFIGURATION', 'MALFORMED_PAYLOAD');

CREATE TABLE "PushInstallation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "providerToken" VARCHAR(512) NOT NULL,
    "status" "PushInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissionGranted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    CONSTRAINT "PushInstallation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushInstallation_installationId_key" UNIQUE ("installationId"),
    CONSTRAINT "PushInstallation_providerToken_key" UNIQUE ("providerToken"),
    CONSTRAINT "PushInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PushInstallation_userId_status_idx" ON "PushInstallation"("userId", "status");
CREATE INDEX "PushInstallation_status_permissionGranted_idx" ON "PushInstallation"("status", "permissionGranted");

CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "state" "NotificationDeliveryState" NOT NULL DEFAULT 'PENDING',
    "failureCode" "NotificationDeliveryFailureCode",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationDelivery_notificationId_installationId_channel_key" UNIQUE ("notificationId", "installationId", "channel"),
    CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NotificationDelivery_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "PushInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "NotificationDelivery_installationId_state_idx" ON "NotificationDelivery"("installationId", "state");
CREATE INDEX "NotificationDelivery_state_createdAt_idx" ON "NotificationDelivery"("state", "createdAt");
