import type { AuditAction } from "@spie/shared";
import type { Db } from "../db/client.js";
import { journalAudit } from "../db/schema.js";

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

export async function audit(db: Db, event: AuditEvent): Promise<void> {
  await db.insert(journalAudit).values({
    action: event.action,
    actorId: event.actorId ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    details: event.details ?? null,
    ip: event.ip ?? null,
  });
}
