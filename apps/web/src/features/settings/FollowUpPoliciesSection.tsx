import type React from "react";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { FollowUpPolicyDto } from "@shilabs/shared-types";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import type { SelectOption } from "../../components/ui/Select.js";
import { listCompanies } from "../../services/api/companies.js";
import { listPipelines } from "../../services/api/deals.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  apiErrorMessage,
  createFollowUpPolicy,
  deleteFollowUpPolicy,
  listFollowUpPolicies,
  listUsers,
  updateFollowUpPolicy,
  type FollowUpPolicyBody
} from "../../services/api-client.js";

const emptyDraft: FollowUpPolicyBody = {
  name: "",
  enabled: true,
  isDefault: false,
  selectionPriority: 0,
  cadenceDays: [0, 1, 5, 9],
  service: null,
  leadType: null,
  source: null,
  country: null,
  priority: null,
  campaign: null,
  companyId: null,
  communicationPersonality: null,
  managerId: null,
  pipelineStageId: null
};

function policyDraft(policy: FollowUpPolicyDto): FollowUpPolicyBody {
  return {
    name: policy.name,
    enabled: policy.enabled,
    isDefault: policy.isDefault,
    selectionPriority: policy.selectionPriority,
    cadenceDays: policy.cadenceDays,
    companyId: policy.companyId ?? null,
    communicationPersonality: policy.communicationPersonality ?? null,
    service: policy.service,
    leadType: policy.leadType,
    source: policy.source,
    country: policy.country,
    priority: policy.priority,
    managerId: policy.managerId,
    campaign: policy.campaign,
    pipelineStageId: policy.pipelineStageId
  };
}

function policyMatches(policy: FollowUpPolicyDto, labels: Record<string, string>): string[] {
  return [
    policy.companyId && `Company: ${labels[policy.companyId] ?? policy.companyId}`,
    policy.managerId && `Manager: ${labels[policy.managerId] ?? policy.managerId}`,
    policy.pipelineStageId && `Stage: ${labels[policy.pipelineStageId] ?? policy.pipelineStageId}`,
    policy.service && `Service: ${policy.service}`,
    policy.leadType && `Lead type: ${policy.leadType}`,
    policy.source && `Source: ${policy.source}`,
    policy.country && `Country: ${policy.country}`,
    policy.priority && `Priority: ${policy.priority}`,
    policy.campaign && `Campaign: ${policy.campaign}`
  ].filter((value): value is string => Boolean(value));
}

export function FollowUpPoliciesSection({
  accessToken
}: {
  accessToken: string;
}): React.JSX.Element {
  const resource = usePersistedResource({
    scope: "workspace-follow-up-policies",
    load: () => listFollowUpPolicies(accessToken),
    accepts: (event) =>
      event.entityType === "workspace" && event.action.startsWith("follow-up-policy-"),
    errorMessage: "Follow-up schedules could not be loaded."
  });
  const [editing, setEditing] = useState<FollowUpPolicyDto | null>(null);
  const [draft, setDraft] = useState<FollowUpPolicyBody>(emptyDraft);
  const [cadence, setCadence] = useState("1, 5, 9");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<
    Record<"companyId" | "managerId" | "pipelineStageId", SelectOption[]>
  >({
    companyId: [],
    managerId: [],
    pipelineStageId: []
  });
  const [choicesError, setChoicesError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setChoicesError(null);
    void Promise.all([
      listCompanies(accessToken),
      listUsers(accessToken),
      listPipelines(accessToken)
    ])
      .then(([companies, users, pipelines]) => {
        if (cancelled) return;
        setChoices({
          companyId: companies.map((company) => ({ value: company.id, label: company.name })),
          managerId: users
            .filter((user) => user.status === "ACTIVE")
            .map((user) => ({
              value: user.id,
              label: `${user.firstName} ${user.lastName}`.trim()
            })),
          pipelineStageId: pipelines
            .filter((pipeline) => pipeline.status === "ACTIVE")
            .flatMap((pipeline) =>
              pipeline.stages
                .filter((stage) => stage.status === "ACTIVE")
                .map((stage) => ({
                  value: stage.id,
                  label: `${pipeline.name}: ${stage.label}`
                }))
            )
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setChoicesError(apiErrorMessage(cause, "Policy match options could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  const choiceLabels = Object.fromEntries(
    Object.values(choices)
      .flat()
      .map((option) => [option.value, option.label])
  );

  const beginCreate = (): void => {
    setEditing(null);
    setDraft(emptyDraft);
    setCadence("1, 5, 9");
    setError(null);
    setOpen(true);
  };

  const beginEdit = (policy: FollowUpPolicyDto): void => {
    setEditing(policy);
    setDraft(policyDraft(policy));
    setCadence(policy.cadenceDays.filter((day) => day > 0).join(", "));
    setError(null);
    setOpen(true);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const parts = cadence.split(",").map((value) => value.trim());
    const days = parts.map(Number);
    const normalized = [...new Set(days)].sort((left, right) => left - right);
    if (
      parts.some((value) => !/^\d+$/.test(value)) ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 365) ||
      normalized.length > 11
    ) {
      setError("Enter 1 to 11 positive whole day numbers from 1 to 365, for example 1, 5, 9.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { ...draft, cadenceDays: [0, ...normalized] };
      if (editing) await updateFollowUpPolicy(accessToken, editing.id, body);
      else await createFollowUpPolicy(accessToken, body);
      setOpen(false);
      await resource.reload();
    } catch (cause) {
      setError(apiErrorMessage(cause, "The follow-up schedule could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (policy: FollowUpPolicyDto): Promise<void> => {
    if (!window.confirm(`Delete “${policy.name}”? Existing lead schedules will not be changed.`))
      return;
    setError(null);
    try {
      await deleteFollowUpPolicy(accessToken, policy.id);
      await resource.reload();
    } catch (cause) {
      setError(apiErrorMessage(cause, "The follow-up schedule could not be deleted."));
    }
  };

  return (
    <>
      <Card className="admin-settings-section follow-up-policy-section">
        <div className="admin-section-heading">
          <div>
            <h2>Automatic follow-up schedules</h2>
            <p>Choose when follow-ups run and which leads use each schedule.</p>
          </div>
          <Button variant="primary" onClick={beginCreate}>
            <Plus size={16} /> New schedule
          </Button>
        </div>
        {error && !open ? <p className="admin-inline-error">{error}</p> : null}
        {resource.loading && !resource.data ? (
          <StateBlock
            title="Loading follow-up schedules"
            detail="Getting the saved workspace rules."
          />
        ) : null}
        {resource.error && !resource.data ? (
          <StateBlock
            title="Follow-up schedules unavailable"
            detail={resource.error}
            action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          />
        ) : null}
        {resource.data?.length === 0 ? (
          <StateBlock
            title="No follow-up schedule yet"
            detail="Create a default schedule before enabling automatic follow-up."
            action={<Button onClick={beginCreate}>Create schedule</Button>}
          />
        ) : null}
        <div className="follow-up-policy-list">
          {resource.data?.map((policy) => {
            const matches = policyMatches(policy, choiceLabels);
            return (
              <article key={policy.id} className="follow-up-policy-row">
                <div className="follow-up-policy-main">
                  <div className="follow-up-policy-title">
                    <strong>{policy.name}</strong>
                    {policy.isDefault ? <Badge tone="accent">Default</Badge> : null}
                    <Badge tone={policy.enabled ? "success" : "neutral"}>
                      {policy.enabled ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <p>Follow up on days {policy.cadenceDays.filter((day) => day > 0).join(", ")}</p>
                  {policy.communicationPersonality ? (
                    <p>{policy.communicationPersonality}</p>
                  ) : null}
                  <small>
                    {matches.length > 0 ? matches.join(" • ") : "Used for all unmatched leads"}
                  </small>
                </div>
                <div className="follow-up-policy-actions">
                  <Button
                    variant="secondary"
                    aria-label={`Edit ${policy.name}`}
                    onClick={() => beginEdit(policy)}
                  >
                    <Pencil size={16} /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${policy.name}`}
                    onClick={() => void remove(policy)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </Card>
      <Modal
        open={open}
        title={editing ? "Edit follow-up schedule" : "New follow-up schedule"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" form="follow-up-policy-form" variant="primary" disabled={busy}>
              {busy ? "Saving..." : "Save schedule"}
            </Button>
          </>
        }
      >
        <form
          id="follow-up-policy-form"
          className="admin-form-grid follow-up-policy-form"
          onSubmit={(event) => void save(event)}
        >
          <label className="admin-field-full">
            Schedule name
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="admin-field-full">
            Follow-up days
            <input
              aria-label="Follow-up days"
              required
              value={cadence}
              onChange={(event) => setCadence(event.target.value)}
              placeholder="1, 5, 9"
            />
            <small>Days after the human response.</small>
          </label>
          <label>
            Service
            <input
              value={draft.service ?? ""}
              onChange={(event) => setDraft({ ...draft, service: event.target.value || null })}
              placeholder="Any service"
            />
          </label>
          {(
            [
              ["companyId", "Company"],
              ["managerId", "Manager"],
              ["pipelineStageId", "Pipeline stage"]
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <Select
                ariaLabel={label}
                value={draft[key] ?? ""}
                onChange={(value) => setDraft({ ...draft, [key]: value || null })}
                options={[
                  { value: "", label: `Any ${label.toLowerCase()}` },
                  ...choices[key],
                  ...(draft[key] && !choices[key].some((option) => option.value === draft[key])
                    ? [{ value: draft[key], label: draft[key] }]
                    : [])
                ]}
              />
            </label>
          ))}
          {choicesError ? (
            <p role="alert" className="admin-inline-error admin-field-full">
              {choicesError}
            </p>
          ) : null}
          <label className="admin-field-full">
            Communication personality
            <textarea
              maxLength={2000}
              rows={3}
              value={draft.communicationPersonality ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, communicationPersonality: event.target.value || null })
              }
            />
          </label>
          <label>
            Selection priority
            <input
              type="number"
              min={-1000}
              max={1000}
              step={1}
              value={draft.selectionPriority}
              onChange={(event) =>
                setDraft({ ...draft, selectionPriority: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Lead source
            <input
              value={draft.source ?? ""}
              onChange={(event) => setDraft({ ...draft, source: event.target.value || null })}
              placeholder="Any source"
            />
          </label>
          <label>
            Lead type
            <input
              value={draft.leadType ?? ""}
              onChange={(event) => setDraft({ ...draft, leadType: event.target.value || null })}
              placeholder="Any type"
            />
          </label>
          <label>
            Country
            <input
              value={draft.country ?? ""}
              onChange={(event) => setDraft({ ...draft, country: event.target.value || null })}
              placeholder="Any country"
            />
          </label>
          <label>
            Priority
            <input
              value={draft.priority ?? ""}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value || null })}
              placeholder="Any priority"
            />
          </label>
          <label>
            Campaign
            <input
              value={draft.campaign ?? ""}
              onChange={(event) => setDraft({ ...draft, campaign: event.target.value || null })}
              placeholder="Any campaign"
            />
          </label>
          <div className="follow-up-policy-switches admin-field-full">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />{" "}
              Active
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
              />{" "}
              Use as the default schedule
            </label>
          </div>
          {error ? (
            <p className="admin-inline-error admin-field-full" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
