import type { AuditEvent, AuditFilterQuery } from '../types/audit';
import { AuditTargetType } from '../types/audit';
import { INITIAL_MOCK_AUDIT_EVENTS } from '../data/mockAuditData';

/**
 * Canonical Platform Audit Service (Append-Only)
 * 
 * ARCHITECTURAL PRINCIPLES:
 * 1. OBSERVATIONAL ONLY: Recording an event never modifies target entity state or grants RBAC permissions.
 * 2. APPEND-ONLY: Existing events can never be edited, deleted, or reordered in storage.
 * 3. DEFENSIVE: All getters return deep/defensive copies to prevent runtime mutations of the audit log.
 * 4. COMPACT & STRUCTURED: Stores field deltas and snapshots, not entire entity blobs or sensitive secrets.
 */
export class AdminAuditService {
  /**
   * In-memory append-only event store initialized with canonical seed data.
   */
  private static events: AuditEvent[] = INITIAL_MOCK_AUDIT_EVENTS.map(evt => ({ ...evt }));

  /**
   * Records a new canonical audit event.
   * Append-only operation: adds the event to the platform audit trail.
   */
  public static recordEvent(
    input: Omit<AuditEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): AuditEvent {
    // 1. Validation of mandatory fields
    if (!input.actorUserId || !input.action || !input.targetType || !input.targetId) {
      console.warn('AdminAuditService: Incomplete audit event payload ignored.', input);
      throw new Error('Audit event requires actorUserId, action, targetType, and targetId.');
    }

    // 2. Build canonical immutable record
    const id = input.id || `audit-evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = input.timestamp || new Date().toISOString();

    const newEvent: AuditEvent = {
      id,
      timestamp,
      actorUserId: input.actorUserId,
      actorName: input.actorName || 'Unknown Actor',
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetTitle: input.targetTitle,
      changes: input.changes ? input.changes.map(c => ({ ...c })) : undefined,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };

    // 3. Append to store
    this.events.push(newEvent);

    // 4. Return defensive copy
    return {
      ...newEvent,
      changes: newEvent.changes ? newEvent.changes.map(c => ({ ...c })) : undefined,
      metadata: newEvent.metadata ? { ...newEvent.metadata } : undefined,
    };
  }

  /**
   * Retrieves audit events, optionally filtered and sorted newest-first by timestamp.
   */
  public static getEvents(query?: AuditFilterQuery): AuditEvent[] {
    let filtered = [...this.events];

    if (query) {
      if (query.actorUserId) {
        filtered = filtered.filter(e => e.actorUserId === query.actorUserId);
      }
      if (query.targetType) {
        filtered = filtered.filter(e => e.targetType === query.targetType);
      }
      if (query.targetId) {
        filtered = filtered.filter(e => e.targetId === query.targetId);
      }
      if (query.action) {
        filtered = filtered.filter(e => e.action === query.action);
      }
      if (query.fromDate) {
        const fromTime = new Date(query.fromDate).getTime();
        filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= fromTime);
      }
      if (query.toDate) {
        const toTime = new Date(query.toDate).getTime();
        filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= toTime);
      }
    }

    // Sort newest-first by canonical timestamp
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Return defensive copies
    return filtered.map(e => ({
      ...e,
      changes: e.changes ? e.changes.map(c => ({ ...c })) : undefined,
      metadata: e.metadata ? { ...e.metadata } : undefined,
    }));
  }

  /**
   * Retrieves all audit events recorded for a specific target entity.
   */
  public static getEventsByTarget(targetType: AuditTargetType, targetId: string): AuditEvent[] {
    return this.getEvents({ targetType, targetId });
  }

  /**
   * Retrieves all audit events performed by a specific actor identity.
   */
  public static getEventsByActor(actorUserId: string): AuditEvent[] {
    return this.getEvents({ actorUserId });
  }

  /**
   * Retrieves a single event by ID.
   */
  public static getEventById(id: string): AuditEvent | undefined {
    const event = this.events.find(e => e.id === id);
    if (!event) return undefined;
    return {
      ...event,
      changes: event.changes ? event.changes.map(c => ({ ...c })) : undefined,
      metadata: event.metadata ? { ...event.metadata } : undefined,
    };
  }

  /**
   * Returns total count of recorded audit events.
   */
  public static getEventCount(): number {
    return this.events.length;
  }
}
