CREATE TABLE `insight_analysis_state` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo_name` text,
	`last_analyzed_at` integer NOT NULL,
	`last_event_timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_state_user` ON `insight_analysis_state` (`user_id`);--> statement-breakpoint
CREATE TABLE `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo_name` text,
	`created_at` integer NOT NULL,
	`analysis_window_start` integer NOT NULL,
	`analysis_window_end` integer NOT NULL,
	`sessions_analyzed` integer NOT NULL,
	`events_analyzed` integer NOT NULL,
	`content` text NOT NULL,
	`categories` text,
	`follow_up_actions` text,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `idx_insights_user` ON `insights` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_insights_repo` ON `insights` (`repo_name`,`created_at`);