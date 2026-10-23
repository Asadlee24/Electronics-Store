CREATE TABLE `admin_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`reset_hash` text,
	`reset_expires` integer,
	`reset_sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer,
	`provider_id` text,
	`last_error` text
);
