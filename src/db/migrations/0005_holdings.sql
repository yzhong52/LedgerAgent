CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`quantity` real NOT NULL,
	`price_per_unit` integer NOT NULL,
	`market_value` integer NOT NULL,
	`cost_basis` integer,
	`currency` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_date_symbol` ON `holdings` (`account_id`,`date`,`symbol`);
