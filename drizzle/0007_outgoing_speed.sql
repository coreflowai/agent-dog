CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_text` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`notify_slack` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`last_run_session_id` text,
	`last_run_status` text,
	`next_run_at` integer,
	`total_runs` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`meta` text DEFAULT '{}'
);
