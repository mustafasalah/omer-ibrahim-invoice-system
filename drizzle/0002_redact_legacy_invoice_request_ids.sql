-- Migration 0001 removed legacy replay payloads, but historical INVOICE_CREATED
-- rows can still have the raw idempotency key in request_id. Because 0001 no
-- longer leaves enough information to distinguish those rows precisely, redact
-- every INVOICE_CREATED request_id present when this migration runs. The only
-- intentional loss is the old request correlation value; all other audit data
-- remains unchanged.
DROP TRIGGER IF EXISTS `audit_logs_prevent_update`;--> statement-breakpoint
UPDATE `audit_logs`
SET `request_id` = 'redacted:audit-event:' || `id`
WHERE `event_type` = 'INVOICE_CREATED';--> statement-breakpoint
CREATE TRIGGER `audit_logs_prevent_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
