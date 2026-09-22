CREATE TABLE `invoice_idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`key_hash` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "invoice_idempotency_operation_valid" CHECK(length(trim("invoice_idempotency_records"."operation")) between 1 and 64),
	CONSTRAINT "invoice_idempotency_key_hash_valid" CHECK(length("invoice_idempotency_records"."key_hash") = 64 and "invoice_idempotency_records"."key_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "invoice_idempotency_request_fingerprint_valid" CHECK(length("invoice_idempotency_records"."request_fingerprint") = 64 and "invoice_idempotency_records"."request_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "invoice_idempotency_response_status_valid" CHECK("invoice_idempotency_records"."response_status" between 100 and 599),
	CONSTRAINT "invoice_idempotency_response_json_valid" CHECK(json_valid("invoice_idempotency_records"."response_json")),
	CONSTRAINT "invoice_idempotency_expiry_valid" CHECK("invoice_idempotency_records"."expires_at" > "invoice_idempotency_records"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_idempotency_user_operation_key_unique` ON `invoice_idempotency_records` (`user_id`,`operation`,`key_hash`);--> statement-breakpoint
CREATE INDEX `invoice_idempotency_expires_idx` ON `invoice_idempotency_records` (`expires_at`,`id`);--> statement-breakpoint
-- Version 1 audit rows do not contain the original canonical request payload, so their
-- request fingerprint cannot be reconstructed safely. Reset legacy replay once rather
-- than guessing, while preserving the audit event and every unrelated change field.
DROP TRIGGER `audit_logs_prevent_update`;--> statement-breakpoint
UPDATE `audit_logs`
SET `changes_json` = json_remove(`changes_json`, '$.createReplay', '$.createIdempotencyKey')
WHERE CASE
  WHEN json_valid(`changes_json`) THEN
    json_type(`changes_json`, '$.createReplay') IS NOT NULL
    OR json_type(`changes_json`, '$.createIdempotencyKey') IS NOT NULL
  ELSE 0
END;--> statement-breakpoint
CREATE TRIGGER `audit_logs_prevent_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
