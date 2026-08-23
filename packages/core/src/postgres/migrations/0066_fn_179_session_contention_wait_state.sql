-- FNXC:WorkspaceContention 2026-08-23-06:40: Persist the bounded scheduling wait so restart cannot reset a live-holder budget or leave an unowned badge.
ALTER TABLE project.tasks ADD COLUMN IF NOT EXISTS session_contention_hold_count integer DEFAULT 0;
ALTER TABLE project.tasks ADD COLUMN IF NOT EXISTS session_contention_wait_reason text;
