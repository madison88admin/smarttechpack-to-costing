import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/supabase-mock";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => mocks.client }));

import { defaultWorkflowSettings, getWorkflowSettings, saveWorkflowSettings } from "../src/lib/admin/settings";

// The retired Manager approval stage left one setting behind: the
// `manager_approval_threshold` key. Its reader is deleted and the live row is
// gone, so these two tests guard the ways it could come back — a save re-adding
// it, or an older stored blob feeding it back into the settings object.

const savedPayload = (calls: Array<{ table: string; chain: { payload?: unknown } }>) =>
  calls.find((call) => call.table === "workflow_settings" && call.chain.payload)?.chain.payload as {
    key: string;
    value: Record<string, unknown>;
  };

describe("workflow settings", () => {
  beforeEach(() => {
    mocks.client = createMockSupabase({
      workflow_settings: { select: () => ({ data: null, error: null }), maybeSingle: () => ({ data: null, error: null }) }
    }).client;
  });

  it("saves every declared field and never re-creates the retired threshold", async () => {
    const { client, calls } = createMockSupabase({
      workflow_settings: { select: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    const saved = await saveWorkflowSettings({
      warningVariancePercent: "12",
      reviewVariancePercent: "9",
      marginThresholdUsd: "2.5",
      mdReviewSlaHours: "8",
      enableEmailNotifications: "true",
      scheduledReportFrequency: "weekly"
    });

    const payload = savedPayload(calls);
    expect(payload.key).toBe("main");
    expect(payload.value).not.toHaveProperty("managerApprovalThreshold");
    expect(payload.value).toMatchObject({
      warningVariancePercent: 12,
      reviewVariancePercent: 9,
      marginThresholdUsd: 2.5,
      mdReviewSlaHours: 8,
      enableEmailNotifications: true,
      scheduledReportFrequency: "weekly"
    });
    // No field may be silently dropped from a save.
    expect(Object.keys(payload.value).sort()).toEqual(Object.keys(defaultWorkflowSettings).sort());
    expect(saved).toEqual(payload.value);
  });

  it("drops a retired key that an older stored blob still carries", async () => {
    const { client } = createMockSupabase({
      workflow_settings: {
        maybeSingle: () => ({
          data: { value: { managerApprovalThreshold: 15, marginThresholdUsd: 3, reminderPercent: 60 } },
          error: null
        })
      }
    });
    mocks.client = client;

    const settings = await getWorkflowSettings();
    expect(settings).not.toHaveProperty("managerApprovalThreshold");
    // Real stored values still win over the defaults.
    expect(settings.marginThresholdUsd).toBe(3);
    expect(settings.reminderPercent).toBe(60);
    expect(Object.keys(settings).sort()).toEqual(Object.keys(defaultWorkflowSettings).sort());
  });
});
