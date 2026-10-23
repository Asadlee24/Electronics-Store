CREATE TABLE `catalogue_products` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_products_slug_unique` ON `catalogue_products` (`slug`);--> statement-breakpoint
CREATE TABLE `order_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`reference` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_requests_reference_unique` ON `order_requests` (`reference`);