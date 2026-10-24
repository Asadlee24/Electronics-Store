CREATE TABLE `email_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `pending_email` text;--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `pending_email_hash` text;--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `pending_email_expires` integer;