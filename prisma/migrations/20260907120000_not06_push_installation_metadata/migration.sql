-- NOT-06: explicit installation channel and operating-system metadata.
-- Existing rows remain NULL because their historical values are unknown.
CREATE TYPE "PushChannel" AS ENUM ('WEB_PUSH', 'NATIVE_PUSH');
CREATE TYPE "PushOs" AS ENUM ('ANDROID', 'WINDOWS', 'MACOS', 'IOS', 'LINUX', 'OTHER');

ALTER TABLE "PushInstallation"
  ADD COLUMN "channel" "PushChannel",
  ADD COLUMN "os" "PushOs";

CREATE INDEX "PushInstallation_status_channel_os_userId_idx"
  ON "PushInstallation"("status", "channel", "os", "userId");
