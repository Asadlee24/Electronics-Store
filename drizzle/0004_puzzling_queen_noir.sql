CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`reference` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_messages_reference_unique` ON `contact_messages` (`reference`);