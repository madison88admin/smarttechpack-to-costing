import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailTransport,
  notificationQueueSummary,
  processNotificationQueue,
  requeueFailedNotifications,
  sendableChannels
} from "../src/lib/notifications/queue";
import { createMockSupabase, updates, type Chain, type Responder } from "./helpers/supabase-mock";

// Contract for the outbound notification queue's transport awareness:
//   * a missing transport must never burn a row's attempts (that is what built
//     the permanently-failed backlog the requeue action exists to clear)
//   * requeue resets `failed` rows to `pending` only when something can send
//   * the three-attempt cap still applies to real send errors
//
// The send path is faked through nodemailer so no test touches the network.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/admin/settings", () => ({
  getWorkflowSettings: () => Promise.resolve({ enableEmailNotifications: true, enableTeamsNotifications: true })
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: () => Promise.reject(new Error("smtp refused the message"))
    })
  }
}));

const GRAPH_ENV = {
  MS_GRAPH_TENANT_ID: "tenant",
  MS_GRAPH_CLIENT_ID: "client",
  MS_GRAPH_CLIENT_SECRET: "secret"
};

// Every transport variable starts empty so a case only ever sees the values it
// declares — a stray Graph credential would otherwise mask the SMTP/dev cases.
function setEnv(env: Record<string, string | undefined>) {
  const cleared = {
    MS_GRAPH_TENANT_ID: undefined,
    MS_GRAPH_CLIENT_ID: undefined,
    MS_GRAPH_CLIENT_SECRET: undefined,
    SMTP_URL: undefined,
    TEAMS_WEBHOOK_URL: undefined
  };
  for (const [key, value] of Object.entries({ ...cleared, ...env })) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
}

function queueResponder(handler: Responder["notification_queue"]): Responder {
  return { notification_queue: handler };
}

/** Rows the responder hands back for the pending queue. */
function pendingRows(rows: Array<{ channel: string; attempts?: number }>): Responder {
  return queueResponder({
    select: () => ({ data: rows.map((row, i) => ({ id: `n-${i}`, recipient: "x@test.local", subject: "s", body: "b", attempts: row.attempts ?? 0, ...row })), error: null }),
    update: () => ({ data: [], error: null })
  });
}

beforeEach(() => {
  setEnv({});
  mocks.client = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.client = null;
});

describe("emailTransport / sendableChannels", () => {
  it.each([
    ["Microsoft Graph takes precedence over SMTP", { MS_GRAPH_TENANT_ID: "t", MS_GRAPH_CLIENT_ID: "c", MS_GRAPH_CLIENT_SECRET: "s", SMTP_URL: "smtp://relay" }, "microsoft-graph"],
    ["SMTP is used when Graph is not configured", { SMTP_URL: "smtp://relay" }, "smtp"],
    ["production without a transport is 'none'", { NODE_ENV: "production" }, "none"],
    ["development falls back to the console logger", { NODE_ENV: "development" }, "dev-console"]
  ])("%s", (_label, env, expected) => {
    setEnv(env as Record<string, string>);
    expect(emailTransport()).toBe(expected);
  });

  it("carries email channels whenever a transport exists, and Teams only with a webhook", () => {
    setEnv({ SMTP_URL: "smtp://relay" });
    expect(sendableChannels()).toEqual(["email", "reminder", "escalation"]);

    setEnv({ SMTP_URL: "smtp://relay", TEAMS_WEBHOOK_URL: "https://teams.example/hook" });
    expect(sendableChannels()).toEqual(["email", "reminder", "escalation", "teams"]);

    setEnv({ NODE_ENV: "production", TEAMS_WEBHOOK_URL: "https://teams.example/hook" });
    expect(sendableChannels()).toEqual(["teams"]);

    setEnv({ NODE_ENV: "production" });
    expect(sendableChannels()).toEqual([]);
  });
});

describe("processNotificationQueue", () => {
  it("touches nothing when no transport can carry the queue", async () => {
    setEnv({ NODE_ENV: "production" });
    const { client, calls } = createMockSupabase(pendingRows([{ channel: "email" }]));
    mocks.client = client;

    const result = await processNotificationQueue();

    expect(result.skipped).toContain("No notification transport configured");
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    // Rows keep their attempts and their status — an unconfigured transport must
    // not walk the backlog to `failed`.
    expect(calls).toHaveLength(0);
  });

  it("selects only channels a transport can carry", async () => {
    setEnv({ NODE_ENV: "production", TEAMS_WEBHOOK_URL: "https://teams.example/hook" });
    const { client, calls } = createMockSupabase(queueResponder({ select: () => ({ data: [], error: null }) }));
    mocks.client = client;

    await processNotificationQueue();

    const query: Chain = calls[0].chain;
    expect(query.in).toEqual([["channel", ["teams"]]]);
    expect(query.eq).toContainEqual(["status", "pending"]);
  });

  it("marks a row sent through the console transport", async () => {
    setEnv({ NODE_ENV: "development" });
    const { client, calls } = createMockSupabase(pendingRows([{ channel: "email" }]));
    mocks.client = client;

    const result = await processNotificationQueue();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect((updates(calls, "notification_queue")[0] as { status: string }).status).toBe("sent");
  });

  it.each([
    ["keeps a first failure pending so it retries", 0, 1, "pending"],
    ["gives up after the third attempt", 2, 3, "failed"]
  ])("%s", async (_label, attempts, expectedAttempts, expectedStatus) => {
    setEnv({ SMTP_URL: "smtp://relay" });
    const { client, calls } = createMockSupabase(pendingRows([{ channel: "email", attempts }]));
    mocks.client = client;

    await processNotificationQueue();

    const update = updates(calls, "notification_queue")[0] as Record<string, unknown>;
    expect(update).toMatchObject({ attempts: expectedAttempts, status: expectedStatus, last_error: "smtp refused the message" });
  });
});

describe("requeueFailedNotifications", () => {
  it("refuses to requeue while no transport exists, leaving the rows untouched", async () => {
    setEnv({ NODE_ENV: "production" });
    const { client, calls } = createMockSupabase(queueResponder({ update: () => ({ data: [{ id: "n-1" }], error: null }) }));
    mocks.client = client;

    const result = await requeueFailedNotifications();

    expect(result.requeued).toBe(0);
    expect(result.transport).toBe("none");
    expect(result.skipped).toContain("No email transport configured yet");
    expect(updates(calls, "notification_queue")).toHaveLength(0);
  });

  it("resets failed rows to pending for sendable channels once a transport is configured", async () => {
    setEnv({ SMTP_URL: "smtp://relay" });
    const { client, calls } = createMockSupabase(
      queueResponder({ select: () => ({ data: [{ id: "n-1" }, { id: "n-2" }], error: null }) })
    );
    mocks.client = client;

    const result = await requeueFailedNotifications();

    expect(result).toEqual({ requeued: 2, transport: "smtp", channels: ["email", "reminder", "escalation"] });
    const query = calls[0].chain;
    expect(query.payload).toEqual({ status: "pending", attempts: 0, last_error: null });
    expect(query.eq).toContainEqual(["status", "failed"]);
    // A row whose channel can never send would only re-fail and spend its
    // attempts again, so the reset is scoped to live channels.
    expect(query.in).toEqual([["channel", ["email", "reminder", "escalation"]]]);
  });

  it("parks every failed row as pending when forced without a transport", async () => {
    setEnv({ NODE_ENV: "production" });
    const { client, calls } = createMockSupabase(queueResponder({ select: () => ({ data: [{ id: "n-1" }], error: null }) }));
    mocks.client = client;

    const result = await requeueFailedNotifications({ force: true });

    expect(result.requeued).toBe(1);
    expect(calls[0].chain.in).toBeUndefined();
  });

  it("surfaces a database error instead of reporting a requeue", async () => {
    setEnv({ SMTP_URL: "smtp://relay" });
    const { client } = createMockSupabase(queueResponder({ select: () => ({ data: null, error: { message: "queue down" } }) }));
    mocks.client = client;

    await expect(requeueFailedNotifications()).rejects.toMatchObject({ message: "queue down" });
  });
});

describe("notificationQueueSummary", () => {
  it("reports the transport, per-status counts and the newest failure reason", async () => {
    setEnv({ SMTP_URL: "smtp://relay" });
    const counts: Record<string, number> = { pending: 27, sent: 9, failed: 354 };

    const { client } = createMockSupabase(
      queueResponder({
        select: (chain) => {
          // The last-error probe is the only summary query that orders rows.
          if (chain.order) return { data: [{ last_error: "Email transport is not configured" }], error: null };
          const status = chain.eq?.find(([col]) => col === "status")?.[1] as string;
          return { data: null, error: null, count: counts[status] ?? 0 };
        }
      })
    );
    mocks.client = client;

    await expect(notificationQueueSummary()).resolves.toEqual({
      transport: "smtp",
      channels: ["email", "reminder", "escalation"],
      pending: 27,
      sent: 9,
      failed: 354,
      lastError: "Email transport is not configured"
    });
  });
});
