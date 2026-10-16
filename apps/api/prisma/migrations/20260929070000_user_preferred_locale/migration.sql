-- AnimBook Languages Phase 1 — i18n foundation.
-- Adds a nullable `preferred_locale` column to `users` so the
-- language switcher can persist the visitor's choice on the row
-- itself (synced across devices, not just via cookie).
ALTER TABLE "users"
    ADD COLUMN "preferred_locale" TEXT;
