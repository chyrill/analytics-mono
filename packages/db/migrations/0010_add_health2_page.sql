-- Migration: register the /health-2 page (Customer Health Index v2)
-- and grant it to role 1 (the first role) so its existing users pick
-- it up automatically. Idempotent — safe to re-run on every deploy.
INSERT INTO "pages" ("path", "label", "sort_order")
VALUES ('/health-2', 'Customer Health Index v2', 7)
ON CONFLICT ("path") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_pages" ("role_id", "page_id", "position")
SELECT 1, p."id", COALESCE((SELECT MAX(rp."position") FROM "role_pages" rp WHERE rp."role_id" = 1), 0) + 1
FROM "pages" p
WHERE p."path" = '/health-2'
ON CONFLICT ("role_id", "page_id") DO NOTHING;
