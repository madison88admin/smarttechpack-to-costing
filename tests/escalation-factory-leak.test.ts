import { afterEach, describe, expect, it, vi } from "vitest";
import { processEscalations } from "../src/lib/notifications/escalation";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

// SLA reminder/escalation emails must never leak internal review stage names
// to factory users. Factory users are excluded from escalation emails about
// internal statuses (for_md_review / for_costing_review / for_pbd_review /
// for_pbd_review), but DO receive them for factory-visible statuses
// like needs_clarification.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/notifications/queue", () => ({
  enqueueNotificationsForPendingEvents: () => Promise.resolve({ processed: 0 })
}));

afterEach(() => {
  mocks.client = null;
});

const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 86_400_000).toISOString();

function settingsResponder(): Responder["workflow_settings"] {
  return {
    maybeSingle: () => ({
      data: {
        value: {
          factorySubmissionSlaHours: 36,
          costingReviewSlaHours: 24,
          pbdApprovalSlaHours: 24,
          approvalSlaDays: 1,
          factorySubmissionSlaDays: 1.5,
          reminderDays: 1,
          escalationDays: 2,
          enableEmailNotifications: false,
          enableTeamsNotifications: false
        }
      },
      error: null
    })
  };
}

function escalationResponder(overrides: Partial<Responder> = {}): Responder {
  return {
    workflow_settings: settingsResponder(),
    costing_requests: {
      select: () => ({
        data: [],
        error: null
      })
    },
    notification_queue: { select: () => ({ data: [], error: null }) },
    ...overrides
  };
}

function requestRows(status: string, updatedAt: string = FIVE_DAYS_AGO) {
  return [
    {
      id: "r1",
      request_number: "CR-5001",
      status,
      factory_name: "Cebu Factory",
      updated_at: updatedAt,
      created_at: updatedAt
    }
  ];
}

function users(rows: Array<{ email: string; role: string }>) {
  return { select: () => ({ data: rows, error: null }) };
}

function escalatedRecipients(calls: ReturnType<typeof createMockSupabase>["calls"]) {
  return (inserts(calls, "notification_queue") as Array<Record<string, unknown>>)
    .filter((p) => p.channel === "escalation" || p.channel === "reminder")
    .map((p) => p.recipient);
}

describe("processEscalations — factory visibility in SLA emails", () => {
  it("excludes factory users from escalations about internal review statuses", async () => {
    const responder = escalationResponder({
      costing_requests: { select: () => ({ data: requestRows("for_pbd_review"), error: null }) },
      user_profiles: users([
        { email: "factory@example.com", role: "factory" },
        { email: "pbd@example.com", role: "pbd" }
      ])
    });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await processEscalations();
    expect(result.escalationsSent).toBe(1);

    const recipients = escalatedRecipients(calls);
    expect(recipients).toContain("pbd@example.com");
    expect(recipients).not.toContain("factory@example.com");

    // No queued escalation is addressed to the factory at all — the internal
    // stage name may appear for internal roles (PBD legitimately sees it), but
    // never in a factory-bound email.
    const queued = inserts(calls, "notification_queue") as Array<Record<string, unknown>>;
    expect(queued.filter((p) => p.recipient === "factory@example.com")).toHaveLength(0);
    const pbdMail = queued.find((p) => p.recipient === "pbd@example.com");
    expect(String(pbdMail?.subject)).toContain("ESCALATION");
    expect(String(pbdMail?.subject)).toContain("for_pbd_review");
  });

  it("includes factory users for factory-visible statuses like needs_clarification", async () => {
    const responder = escalationResponder({
      costing_requests: { select: () => ({ data: requestRows("needs_clarification"), error: null }) },
      user_profiles: users([
        { email: "factory@example.com", role: "factory" },
        { email: "pbd@example.com", role: "pbd" }
      ])
    });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await processEscalations();
    expect(result.escalationsSent).toBe(1);

    const recipients = escalatedRecipients(calls);
    expect(recipients).toContain("factory@example.com");
    expect(recipients).toContain("pbd@example.com");
  });

  it("handles the case where the only active users are factory (internal status → nobody emailed)", async () => {
    const responder = escalationResponder({
      costing_requests: { select: () => ({ data: requestRows("for_costing_review"), error: null }) },
      user_profiles: users([{ email: "factory@example.com", role: "factory" }])
    });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await processEscalations();
    expect(result.escalationsSent).toBe(1); // the breach was still processed
    expect(escalatedRecipients(calls)).toHaveLength(0); // but no factory recipient got it
  });

  it("still escalates internal statuses to non-factory roles and the configured fallback", async () => {
    process.env.ESCALATION_EMAIL = "manager@example.com";
    try {
      const responder = escalationResponder({
        costing_requests: { select: () => ({ data: requestRows("for_pbd_review"), error: null }) },
        user_profiles: users([{ email: "factory@example.com", role: "factory" }])
      });
      const { client, calls } = createMockSupabase(responder);
      mocks.client = client;

      const result = await processEscalations();
      expect(result.escalationsSent).toBe(1);

      const recipients = escalatedRecipients(calls);
      expect(recipients).toContain("manager@example.com");
      expect(recipients).not.toContain("factory@example.com");
    } finally {
      delete process.env.ESCALATION_EMAIL;
    }
  });
});

describe("processEscalations — SLA timing (percentage-based reminders)", () => {
  const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  function timingResponder(status: string, updatedAt: string, slaHours: Record<string, number>) {
    const responder = escalationResponder({
      costing_requests: { select: () => ({ data: requestRows(status, updatedAt), error: null }) },
      user_profiles: users([{ email: "pbd@example.com", role: "pbd" }])
    });
    responder.workflow_settings = {
      maybeSingle: () => ({
        data: { value: { reminderPercent: 80, escalationDays: 2, ...slaHours } },
        error: null
      })
    };
    return responder;
  }

  it("does NOT send a reminder on day 0 of a 24h SLA (6h in, below the 80% threshold)", async () => {
    const { client, calls } = createMockSupabase(
      timingResponder("for_pbd_review", HOURS_AGO(6), { pbdApprovalSlaHours: 24 })
    );
    mocks.client = client;

    const result = await processEscalations();
    expect(result.remindersSent).toBe(0);
    expect(result.escalationsSent).toBe(0);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
  });

  it("sends a reminder at 80% of a 24h SLA (20h in) with the hours in the subject", async () => {
    const { client, calls } = createMockSupabase(
      timingResponder("for_pbd_review", HOURS_AGO(20), { pbdApprovalSlaHours: 24 })
    );
    mocks.client = client;

    const result = await processEscalations();
    expect(result.remindersSent).toBe(1);
    expect(result.escalationsSent).toBe(0);
    const queued = inserts(calls, "notification_queue") as Array<Record<string, unknown>>;
    expect(String(queued[0].subject)).toContain("Reminder");
    expect(String(queued[0].subject)).toContain("/ 24h");
    expect(String(queued[0].body)).toContain("Hours in current status");
  });

  it("escalates only after the SLA plus the grace window has elapsed (80h in a 24h SLA)", async () => {
    const { client, calls } = createMockSupabase(
      timingResponder("for_pbd_review", HOURS_AGO(80), { pbdApprovalSlaHours: 24 })
    );
    mocks.client = client;

    const result = await processEscalations();
    expect(result.escalationsSent).toBe(1);
    expect(result.remindersSent).toBe(0);
    const queued = inserts(calls, "notification_queue") as Array<Record<string, unknown>>;
    expect(String(queued[0].subject)).toContain("ESCALATION");
  });

  it("escalates unsent drafts once past the 48h draft SLA", async () => {
    const { client, calls } = createMockSupabase(
      timingResponder("draft", HOURS_AGO(100), { draftSlaHours: 48 })
    );
    mocks.client = client;

    const result = await processEscalations();
    expect(result.escalationsSent).toBe(1);
    const queued = inserts(calls, "notification_queue") as Array<Record<string, unknown>>;
    expect(String(queued[0].subject)).toContain("ESCALATION");
  });

  it("sends nothing for a fresh draft (10h in a 48h SLA)", async () => {
    const { client, calls } = createMockSupabase(
      timingResponder("draft", HOURS_AGO(10), { draftSlaHours: 48 })
    );
    mocks.client = client;

    const result = await processEscalations();
    expect(result.remindersSent).toBe(0);
    expect(result.escalationsSent).toBe(0);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
  });
});
