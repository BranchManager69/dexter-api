-- Drop legacy account linking tables now that OAuth flow has replaced code-based linking
DROP TABLE IF EXISTS "account_links";
DROP TABLE IF EXISTS "linking_codes";
