-- A connected account is either an Instagram professional account (the default,
-- so every existing row keeps its meaning) or a Facebook Page. Additive only:
-- no existing data is rewritten.
CREATE TYPE "AccountPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

ALTER TABLE "InstagramAccount"
  ADD COLUMN "platform" "AccountPlatform" NOT NULL DEFAULT 'INSTAGRAM';
