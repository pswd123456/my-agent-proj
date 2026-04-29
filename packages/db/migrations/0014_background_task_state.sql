DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'background_tasks'
      AND column_name = 'task_card'
  ) THEN
    ALTER TABLE "background_tasks"
      RENAME COLUMN "task_card" TO "task_state";
  END IF;
END
$$;

UPDATE "background_tasks"
SET "task_state" = jsonb_set("task_state", '{kind}', '"delegate"'::jsonb, true)
WHERE "task_state" IS NOT NULL
  AND jsonb_typeof("task_state") = 'object'
  AND NOT ("task_state" ? 'kind');
