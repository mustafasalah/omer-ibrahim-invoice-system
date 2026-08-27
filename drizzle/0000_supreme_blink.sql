CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name_ar` text NOT NULL,
	`company_name_en` text NOT NULL,
	`address` text,
	`phones_json` text DEFAULT '[]' NOT NULL,
	`email` text,
	`registration_number` text,
	`currency_code` text NOT NULL,
	`currency_symbol_ar` text NOT NULL,
	`currency_decimals` integer NOT NULL,
	`tax_enabled` integer DEFAULT false NOT NULL,
	`default_tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`invoice_number_prefix` text NOT NULL,
	`invoice_number_pattern` text NOT NULL,
	`sequence_start` integer NOT NULL,
	`sequence_reset_policy` text NOT NULL,
	`default_payment_terms` text,
	`footer_text` text,
	`date_display_format` text NOT NULL,
	`paper_format` text NOT NULL,
	`timezone` text NOT NULL,
	`lan_access_enabled` integer DEFAULT false NOT NULL,
	`session_idle_minutes` integer NOT NULL,
	`session_absolute_hours` integer NOT NULL,
	`company_logo_asset_id` text,
	`stamp_asset_id` text,
	`signature_asset_id` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`company_logo_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`stamp_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`signature_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "app_settings_singleton" CHECK("app_settings"."id" = 'default'),
	CONSTRAINT "app_settings_currency_code_length" CHECK(length("app_settings"."currency_code") = 3),
	CONSTRAINT "app_settings_currency_decimals_range" CHECK("app_settings"."currency_decimals" between 0 and 3),
	CONSTRAINT "app_settings_tax_enabled_boolean" CHECK("app_settings"."tax_enabled" in (0, 1)),
	CONSTRAINT "app_settings_tax_rate_range" CHECK("app_settings"."default_tax_rate_bps" between 0 and 10000),
	CONSTRAINT "app_settings_prefix_length" CHECK(length("app_settings"."invoice_number_prefix") between 1 and 20),
	CONSTRAINT "app_settings_pattern_length" CHECK(length("app_settings"."invoice_number_pattern") between 1 and 100),
	CONSTRAINT "app_settings_sequence_start_positive" CHECK("app_settings"."sequence_start" >= 1),
	CONSTRAINT "app_settings_reset_policy_valid" CHECK("app_settings"."sequence_reset_policy" in ('NEVER', 'YEARLY')),
	CONSTRAINT "app_settings_date_format_valid" CHECK("app_settings"."date_display_format" in ('DD/MM/YYYY', 'YYYY-MM-DD')),
	CONSTRAINT "app_settings_paper_format_valid" CHECK("app_settings"."paper_format" in ('A4', 'A5')),
	CONSTRAINT "app_settings_lan_access_boolean" CHECK("app_settings"."lan_access_enabled" in (0, 1)),
	CONSTRAINT "app_settings_idle_minutes_range" CHECK("app_settings"."session_idle_minutes" between 5 and 1440),
	CONSTRAINT "app_settings_absolute_hours_range" CHECK("app_settings"."session_absolute_hours" between 1 and 720),
	CONSTRAINT "app_settings_row_version_positive" CHECK("app_settings"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text,
	`actor_display_name` text,
	`invoice_id` text,
	`invoice_number` text,
	`entity_type` text,
	`entity_id` text,
	`summary` text NOT NULL,
	`changes_json` text,
	`created_at` text NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "audit_logs_event_type_not_blank" CHECK(length(trim("audit_logs"."event_type")) > 0),
	CONSTRAINT "audit_logs_summary_not_blank" CHECK(length(trim("audit_logs"."summary")) > 0),
	CONSTRAINT "audit_logs_request_id_not_blank" CHECK(length(trim("audit_logs"."request_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_event_type_idx` ON `audit_logs` (`event_type`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_user_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_invoice_idx` ON `audit_logs` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `beneficiaries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`phone` text,
	`address` text,
	`registration_number` text,
	`is_active` integer DEFAULT true NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "beneficiaries_name_not_blank" CHECK(length(trim("beneficiaries"."name")) > 0),
	CONSTRAINT "beneficiaries_name_length" CHECK(length("beneficiaries"."name") <= 200),
	CONSTRAINT "beneficiaries_normalized_name_not_blank" CHECK(length("beneficiaries"."normalized_name") > 0),
	CONSTRAINT "beneficiaries_is_active_boolean" CHECK("beneficiaries"."is_active" in (0, 1)),
	CONSTRAINT "beneficiaries_use_count_non_negative" CHECK("beneficiaries"."use_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `beneficiaries_normalized_name_idx` ON `beneficiaries` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `beneficiaries_active_last_used_idx` ON `beneficiaries` (`is_active`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `dealer_logos` (
	`id` text PRIMARY KEY NOT NULL,
	`media_asset_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "dealer_logos_sort_order_range" CHECK("dealer_logos"."sort_order" between 0 and 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealer_logos_media_asset_unique` ON `dealer_logos` (`media_asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealer_logos_sort_order_unique` ON `dealer_logos` (`sort_order`);--> statement-breakpoint
CREATE TABLE `invoice_dealer_logos` (
	`invoice_id` text NOT NULL,
	`media_asset_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`invoice_id`, `sort_order`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "invoice_dealer_logos_sort_order_range" CHECK("invoice_dealer_logos"."sort_order" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`product_id` text,
	`sort_order` integer NOT NULL,
	`product_name` text,
	`description` text,
	`unit` text,
	`quantity_decimal` text,
	`unit_price_decimal` text,
	`base_minor` integer DEFAULT 0 NOT NULL,
	`discount_kind` text DEFAULT 'NONE' NOT NULL,
	`discount_rate_bps` integer,
	`discount_input_minor` integer,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`allocated_invoice_discount_minor` integer DEFAULT 0 NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`taxable_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`line_total_minor` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "invoice_items_sort_order_non_negative" CHECK("invoice_items"."sort_order" >= 0),
	CONSTRAINT "invoice_items_product_name_length" CHECK("invoice_items"."product_name" is null or length("invoice_items"."product_name") <= 250),
	CONSTRAINT "invoice_items_description_length" CHECK("invoice_items"."description" is null or length("invoice_items"."description") <= 500),
	CONSTRAINT "invoice_items_unit_length" CHECK("invoice_items"."unit" is null or length("invoice_items"."unit") <= 50),
	CONSTRAINT "invoice_items_discount_kind_valid" CHECK("invoice_items"."discount_kind" in ('NONE', 'PERCENT', 'FIXED')),
	CONSTRAINT "invoice_items_discount_rate_range" CHECK("invoice_items"."discount_rate_bps" is null or "invoice_items"."discount_rate_bps" between 0 and 10000),
	CONSTRAINT "invoice_items_base_non_negative" CHECK("invoice_items"."base_minor" >= 0),
	CONSTRAINT "invoice_items_discount_non_negative" CHECK("invoice_items"."discount_minor" >= 0),
	CONSTRAINT "invoice_items_allocated_discount_non_negative" CHECK("invoice_items"."allocated_invoice_discount_minor" >= 0),
	CONSTRAINT "invoice_items_tax_rate_range" CHECK("invoice_items"."tax_rate_bps" between 0 and 10000),
	CONSTRAINT "invoice_items_taxable_non_negative" CHECK("invoice_items"."taxable_minor" >= 0),
	CONSTRAINT "invoice_items_tax_non_negative" CHECK("invoice_items"."tax_minor" >= 0),
	CONSTRAINT "invoice_items_line_total_non_negative" CHECK("invoice_items"."line_total_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_items_invoice_sort_unique` ON `invoice_items` (`invoice_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `invoice_items_product_name_idx` ON `invoice_items` (`product_name`);--> statement-breakpoint
CREATE INDEX `invoice_items_product_id_idx` ON `invoice_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `invoice_print_snapshots` (
	`invoice_id` text PRIMARY KEY NOT NULL,
	`company_name_ar` text NOT NULL,
	`company_name_en` text NOT NULL,
	`address` text,
	`phones_json` text NOT NULL,
	`email` text,
	`registration_number` text,
	`footer_text` text,
	`company_logo_asset_id` text,
	`stamp_asset_id` text,
	`signature_asset_id` text,
	`paper_format` text NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_logo_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`stamp_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`signature_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "invoice_print_snapshots_paper_format_valid" CHECK("invoice_print_snapshots"."paper_format" in ('A4', 'A5'))
);
--> statement-breakpoint
CREATE TABLE `invoice_sequences` (
	`sequence_key` text PRIMARY KEY NOT NULL,
	`last_value` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "invoice_sequences_key_not_blank" CHECK(length(trim("invoice_sequences"."sequence_key")) > 0),
	CONSTRAINT "invoice_sequences_last_value_non_negative" CHECK("invoice_sequences"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_status` text DEFAULT 'DRAFT' NOT NULL,
	`payment_status` text DEFAULT 'UNPAID' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text,
	`beneficiary_id` text,
	`beneficiary_name` text,
	`beneficiary_phone` text,
	`beneficiary_address` text,
	`beneficiary_registration_number` text,
	`currency_code` text NOT NULL,
	`currency_symbol` text NOT NULL,
	`currency_decimals` integer NOT NULL,
	`tax_enabled` integer DEFAULT false NOT NULL,
	`invoice_discount_kind` text DEFAULT 'NONE' NOT NULL,
	`invoice_discount_rate_bps` integer,
	`invoice_discount_input_minor` integer,
	`subtotal_minor` integer DEFAULT 0 NOT NULL,
	`line_discounts_minor` integer DEFAULT 0 NOT NULL,
	`invoice_discount_minor` integer DEFAULT 0 NOT NULL,
	`discount_total_minor` integer DEFAULT 0 NOT NULL,
	`taxable_total_minor` integer DEFAULT 0 NOT NULL,
	`tax_total_minor` integer DEFAULT 0 NOT NULL,
	`grand_total_minor` integer DEFAULT 0 NOT NULL,
	`gross_paid_minor` integer DEFAULT 0 NOT NULL,
	`refunded_total_minor` integer DEFAULT 0 NOT NULL,
	`net_collected_minor` integer DEFAULT 0 NOT NULL,
	`remaining_minor` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`payment_terms` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`issued_at` text,
	`issued_by` text,
	`cancelled_at` text,
	`cancelled_by` text,
	`cancellation_reason` text,
	`archived_at` text,
	`archived_by` text,
	`copied_from_invoice_id` text,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `beneficiaries`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`copied_from_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "invoices_status_valid" CHECK("invoices"."invoice_status" in ('DRAFT', 'ISSUED', 'CANCELLED')),
	CONSTRAINT "invoices_payment_status_valid" CHECK("invoices"."payment_status" in ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED')),
	CONSTRAINT "invoices_is_archived_boolean" CHECK("invoices"."is_archived" in (0, 1)),
	CONSTRAINT "invoices_date_format" CHECK("invoices"."invoice_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "invoices_due_date_order" CHECK("invoices"."due_date" is null or "invoices"."due_date" >= "invoices"."invoice_date"),
	CONSTRAINT "invoices_currency_code_length" CHECK(length("invoices"."currency_code") = 3),
	CONSTRAINT "invoices_currency_decimals_range" CHECK("invoices"."currency_decimals" between 0 and 3),
	CONSTRAINT "invoices_tax_enabled_boolean" CHECK("invoices"."tax_enabled" in (0, 1)),
	CONSTRAINT "invoices_discount_kind_valid" CHECK("invoices"."invoice_discount_kind" in ('NONE', 'PERCENT', 'FIXED')),
	CONSTRAINT "invoices_discount_rate_range" CHECK("invoices"."invoice_discount_rate_bps" is null or "invoices"."invoice_discount_rate_bps" between 0 and 10000),
	CONSTRAINT "invoices_subtotal_non_negative" CHECK("invoices"."subtotal_minor" >= 0),
	CONSTRAINT "invoices_line_discounts_non_negative" CHECK("invoices"."line_discounts_minor" >= 0),
	CONSTRAINT "invoices_invoice_discount_non_negative" CHECK("invoices"."invoice_discount_minor" >= 0),
	CONSTRAINT "invoices_discount_total_non_negative" CHECK("invoices"."discount_total_minor" >= 0),
	CONSTRAINT "invoices_taxable_total_non_negative" CHECK("invoices"."taxable_total_minor" >= 0),
	CONSTRAINT "invoices_tax_total_non_negative" CHECK("invoices"."tax_total_minor" >= 0),
	CONSTRAINT "invoices_grand_total_non_negative" CHECK("invoices"."grand_total_minor" >= 0),
	CONSTRAINT "invoices_gross_paid_non_negative" CHECK("invoices"."gross_paid_minor" >= 0),
	CONSTRAINT "invoices_refunded_total_non_negative" CHECK("invoices"."refunded_total_minor" >= 0),
	CONSTRAINT "invoices_net_collected_non_negative" CHECK("invoices"."net_collected_minor" >= 0),
	CONSTRAINT "invoices_remaining_non_negative" CHECK("invoices"."remaining_minor" >= 0),
	CONSTRAINT "invoices_notes_length" CHECK("invoices"."notes" is null or length("invoices"."notes") <= 2000),
	CONSTRAINT "invoices_payment_terms_length" CHECK("invoices"."payment_terms" is null or length("invoices"."payment_terms") <= 2000),
	CONSTRAINT "invoices_row_version_positive" CHECK("invoices"."row_version" >= 1),
	CONSTRAINT "invoices_archive_metadata_consistent" CHECK(("invoices"."is_archived" = 0 and "invoices"."archived_at" is null and "invoices"."archived_by" is null) or ("invoices"."is_archived" = 1 and "invoices"."archived_at" is not null and "invoices"."archived_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_date_number_idx` ON `invoices` (`invoice_date`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_status_payment_archive_idx` ON `invoices` (`invoice_status`,`payment_status`,`is_archived`);--> statement-breakpoint
CREATE INDEX `invoices_beneficiary_name_idx` ON `invoices` (`beneficiary_name`);--> statement-breakpoint
CREATE INDEX `invoices_created_by_idx` ON `invoices` (`created_by`);--> statement-breakpoint
CREATE INDEX `invoices_due_date_idx` ON `invoices` (`due_date`);--> statement-breakpoint
CREATE INDEX `invoices_grand_total_idx` ON `invoices` (`grand_total_minor`);--> statement-breakpoint
CREATE INDEX `invoices_updated_at_idx` ON `invoices` (`updated_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`relative_path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "media_assets_kind_valid" CHECK("media_assets"."kind" in ('COMPANY_LOGO', 'STAMP', 'SIGNATURE', 'DEALER_LOGO')),
	CONSTRAINT "media_assets_mime_type_valid" CHECK("media_assets"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "media_assets_relative_path_only" CHECK("media_assets"."relative_path" not like '/%'),
	CONSTRAINT "media_assets_sha256_length" CHECK(length("media_assets"."sha256") = 64),
	CONSTRAINT "media_assets_size_positive" CHECK("media_assets"."size_bytes" > 0),
	CONSTRAINT "media_assets_width_positive" CHECK("media_assets"."width_px" > 0),
	CONSTRAINT "media_assets_height_positive" CHECK("media_assets"."height_px" > 0),
	CONSTRAINT "media_assets_is_active_boolean" CHECK("media_assets"."is_active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_relative_path_unique` ON `media_assets` (`relative_path`);--> statement-breakpoint
CREATE INDEX `media_assets_kind_active_idx` ON `media_assets` (`kind`,`is_active`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text,
	`unit` text,
	`last_unit_price_decimal` text,
	`last_currency_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "products_name_not_blank" CHECK(length(trim("products"."name")) > 0),
	CONSTRAINT "products_name_length" CHECK(length("products"."name") <= 250),
	CONSTRAINT "products_description_length" CHECK("products"."description" is null or length("products"."description") <= 500),
	CONSTRAINT "products_unit_length" CHECK("products"."unit" is null or length("products"."unit") <= 50),
	CONSTRAINT "products_currency_code_length" CHECK("products"."last_currency_code" is null or length("products"."last_currency_code") = 3),
	CONSTRAINT "products_is_active_boolean" CHECK("products"."is_active" in (0, 1)),
	CONSTRAINT "products_use_count_non_negative" CHECK("products"."use_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `products_normalized_name_idx` ON `products` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `products_active_last_used_idx` ON `products` (`is_active`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	`revoked_at` text,
	`client_label` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "sessions_token_hash_not_blank" CHECK(length("sessions"."token_hash") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_revoked_idx` ON `sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text COLLATE NOCASE NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "users_username_not_blank" CHECK(length(trim("users"."username")) > 0),
	CONSTRAINT "users_display_name_not_blank" CHECK(length(trim("users"."display_name")) > 0),
	CONSTRAINT "users_role_valid" CHECK("users"."role" in ('ADMIN', 'EMPLOYEE')),
	CONSTRAINT "users_is_active_boolean" CHECK("users"."is_active" in (0, 1)),
	CONSTRAINT "users_must_change_password_boolean" CHECK("users"."must_change_password" in (0, 1)),
	CONSTRAINT "users_failed_login_non_negative" CHECK("users"."failed_login_count" >= 0),
	CONSTRAINT "users_row_version_positive" CHECK("users"."row_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `users_active_role_idx` ON `users` (`is_active`,`role`);
--> statement-breakpoint
CREATE TRIGGER `audit_logs_prevent_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_logs_prevent_delete`
BEFORE DELETE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
