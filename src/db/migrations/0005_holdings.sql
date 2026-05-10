CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`sync_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`quantity` real NOT NULL,
	`price_per_unit` integer NOT NULL,
	`market_value` integer NOT NULL,
	`cost_basis` integer,
	`currency` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sync_id`) REFERENCES `syncs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_sync_symbol` ON `holdings` (`account_id`,`sync_id`,`symbol`);