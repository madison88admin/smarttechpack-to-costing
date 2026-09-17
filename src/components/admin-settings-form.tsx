"use client";

import { useState, type FormEvent } from "react";
import type { WorkflowSettings } from "@/lib/admin/settings";

export function AdminSettingsForm({ settings }: { settings: WorkflowSettings }) {
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Saving settings...");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warningVariancePercent: form.get("warningVariancePercent"),
        reviewVariancePercent: form.get("reviewVariancePercent"),
        approvalSlaDays: form.get("approvalSlaDays"),
        factorySubmissionSlaDays: form.get("factorySubmissionSlaDays"),
        draftSlaHours: form.get("draftSlaHours"),
        factorySubmissionSlaHours: form.get("factorySubmissionSlaHours"),
        mdReviewSlaHours: form.get("mdReviewSlaHours"),
        costingReviewSlaHours: form.get("costingReviewSlaHours"),
        pbdApprovalSlaHours: form.get("pbdApprovalSlaHours"),
        reminderPercent: form.get("reminderPercent"),
        marginThresholdUsd: form.get("marginThresholdUsd"),
        enableEmailNotifications: form.get("enableEmailNotifications") === "on",
        enableTeamsNotifications: form.get("enableTeamsNotifications") === "on",
        enableScheduledReports: form.get("enableScheduledReports") === "on",
        scheduledReportFrequency: form.get("scheduledReportFrequency"),
        scheduledReportHourUtc: form.get("scheduledReportHourUtc"),
        scheduledReportRecipients: form.get("scheduledReportRecipients")
      })
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "Settings saved" : result.error ?? "Unable to save settings");
  }

  return (
    <form className="form-grid" onSubmit={save}>
      <div className="field">
        <label htmlFor="warningVariancePercent">Warning variance %</label>
        <input id="warningVariancePercent" name="warningVariancePercent" className="input" defaultValue={settings.warningVariancePercent} />
      </div>
      <div className="field">
        <label htmlFor="reviewVariancePercent">Review variance %</label>
        <input id="reviewVariancePercent" name="reviewVariancePercent" className="input" defaultValue={settings.reviewVariancePercent} />
      </div>
      <div className="field">
        <label htmlFor="approvalSlaDays">PBD SLA days</label>
        <input id="approvalSlaDays" name="approvalSlaDays" className="input" defaultValue={settings.approvalSlaDays} />
      </div>
      <div className="field">
        <label htmlFor="factorySubmissionSlaDays">Factory SLA days (legacy)</label>
        <input id="factorySubmissionSlaDays" name="factorySubmissionSlaDays" className="input" defaultValue={settings.factorySubmissionSlaDays} />
      </div>
      <div className="field">
        <label htmlFor="draftSlaHours">Draft SLA hours (unsent requests)</label>
        <input id="draftSlaHours" name="draftSlaHours" type="number" min="1" className="input" defaultValue={settings.draftSlaHours ?? 48} />
        <p className="eyebrow">How long a PBD-created draft may sit unsent before it escalates.</p>
      </div>
      <div className="field">
        <label htmlFor="factorySubmissionSlaHours">Factory SLA hours</label>
        <input id="factorySubmissionSlaHours" name="factorySubmissionSlaHours" type="number" min="1" className="input" defaultValue={settings.factorySubmissionSlaHours ?? 36} />
      </div>
      <div className="field">
        <label htmlFor="mdReviewSlaHours">MD review SLA hours</label>
        <input id="mdReviewSlaHours" name="mdReviewSlaHours" type="number" min="1" className="input" defaultValue={settings.mdReviewSlaHours ?? 24} />
      </div>
      <div className="field">
        <label htmlFor="costingReviewSlaHours">Costing review SLA hours</label>
        <input id="costingReviewSlaHours" name="costingReviewSlaHours" type="number" min="1" className="input" defaultValue={settings.costingReviewSlaHours ?? 24} />
      </div>
      <div className="field">
        <label htmlFor="pbdApprovalSlaHours">PBD approval SLA hours</label>
        <input id="pbdApprovalSlaHours" name="pbdApprovalSlaHours" type="number" min="1" className="input" defaultValue={settings.pbdApprovalSlaHours ?? 24} />
      </div>
      <div className="field">
        <label htmlFor="reminderPercent">SLA reminder at % of SLA</label>
        <input id="reminderPercent" name="reminderPercent" type="number" min="1" max="100" className="input" defaultValue={settings.reminderPercent ?? 80} />
        <p className="eyebrow">Reminder fires at this % of the SLA (e.g. 80% of 24h = 19.2h), never on day 0.</p>
      </div>
      <label className="checkbox-row">
        <input name="enableEmailNotifications" type="checkbox" defaultChecked={settings.enableEmailNotifications} />
        Email notification queue enabled
      </label>
      <label className="checkbox-row">
        <input name="enableTeamsNotifications" type="checkbox" defaultChecked={settings.enableTeamsNotifications} />
        Teams notification queue enabled
      </label>
      <label className="checkbox-row full">
        <input name="enableScheduledReports" type="checkbox" defaultChecked={settings.enableScheduledReports} />
        Scheduled reporting enabled
      </label>
      <div className="field">
        <label htmlFor="scheduledReportFrequency">Report frequency</label>
        <select id="scheduledReportFrequency" name="scheduledReportFrequency" className="input" defaultValue={settings.scheduledReportFrequency}>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="scheduledReportHourUtc">Send hour (UTC)</label>
        <input id="scheduledReportHourUtc" name="scheduledReportHourUtc" type="number" min="0" max="23" className="input" defaultValue={settings.scheduledReportHourUtc} />
      </div>
      <div className="field full">
        <label htmlFor="scheduledReportRecipients">Report recipients</label>
        <input id="scheduledReportRecipients" name="scheduledReportRecipients" className="input" placeholder="team@madison88.com, pbd@madison88.com" defaultValue={settings.scheduledReportRecipients} />
        <p className="eyebrow">Recipients are stored as configuration; actual delivery still requires SMTP or Microsoft Graph credentials.</p>
      </div>
      <div className="field full">
        <label htmlFor="marginThresholdUsd">Minimum Gross Margin per Unit (USD)</label>
        <input id="marginThresholdUsd" name="marginThresholdUsd" className="input" placeholder="e.g. 1.00" defaultValue={settings.marginThresholdUsd ?? 1} />
        <p className="eyebrow">Soft guideline — wholesale price minus landed cost. Below this is flagged for the Costing ↔ PBD discussion but never blocks approval.</p>
      </div>
      <div className="form-actions">
        <button className="button" type="submit">Save Settings</button>
        {message ? <span className="form-message saved">{message}</span> : null}
      </div>
    </form>
  );
}
