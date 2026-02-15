CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`source` text NOT NULL,
	`category` text NOT NULL,
	`type` text NOT NULL,
	`role` text,
	`text` text,
	`tool_name` text,
	`tool_input` text,
	`tool_output` text,
	`error` text,
	`meta` text DEFAULT '{}',
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_session` ON `events` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`start_time` integer NOT NULL,
	`last_event_time` integer NOT NULL,
	`status` text DEFAULT 'active',
	`metadata` text DEFAULT '{}'
);
