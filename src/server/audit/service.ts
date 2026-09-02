import "server-only";

import { ulid } from "ulid";
import type { DatabaseConnection } from "@/server/db/connection";
import { auditLogs } from "@/server/db/schema";

export type AuditEvent = {
  eventType: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  entityType: string | null;
  entityId: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  summary: string;
  changes?: Record<string, unknown>;
  createdAt: string;
  requestId: string;
};

export function appendAuditEvent(connection: DatabaseConnection, event: AuditEvent): void {
  connection.db
    .insert(auditLogs)
    .values({
      id: ulid(),
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorDisplayName: event.actorDisplayName,
      invoiceId: event.invoiceId ?? null,
      invoiceNumber: event.invoiceNumber ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      summary: event.summary,
      changesJson: event.changes ? JSON.stringify(event.changes) : null,
      createdAt: event.createdAt,
      requestId: event.requestId,
    })
    .run();
}
