ALTER TABLE "agent_sessions"
  ADD COLUMN "first_user_message" text;

UPDATE "agent_sessions" AS sessions
SET "first_user_message" = first_user_messages."content"
FROM (
  SELECT DISTINCT ON ("session_id")
    "session_id",
    "content"
  FROM "session_messages"
  WHERE "role" = 'user'
    AND "content" IS NOT NULL
    AND btrim("content") <> ''
  ORDER BY "session_id", "message_index" ASC
) AS first_user_messages
WHERE sessions."id" = first_user_messages."session_id"
  AND sessions."first_user_message" IS NULL;
