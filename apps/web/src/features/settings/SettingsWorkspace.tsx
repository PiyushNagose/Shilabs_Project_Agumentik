import type React from "react";
import { useEffect, useState } from "react";
import type { PublicUser, ScoringConfigDto } from "@shilabs/shared-types";
import { Badge, Button, Card } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import { isWorkspaceAdmin, isWorkspaceManager, workspaceRole } from "../auth/workspace-access.js";
import {
  apiErrorMessage,
  getScoringConfig,
  updateOwnProfile,
  updateScoringConfig
} from "../../services/api-client.js";
import { FollowUpPoliciesSection } from "./FollowUpPoliciesSection.js";
import { PrivacySection } from "./PrivacySection.js";

const scoreFields: { key: keyof ScoringConfigDto; label: string }[] = [
  { key: "requirementWeight", label: "Customer requirement" },
  { key: "authorityWeight", label: "Decision authority" },
  { key: "budgetWeight", label: "Budget" },
  { key: "timelineWeight", label: "Timeline" },
  { key: "businessFitWeight", label: "Business fit" }
];

export function SettingsWorkspace({
  accessToken,
  currentUser,
  onUserUpdated
}: {
  accessToken: string;
  currentUser: PublicUser;
  onUserUpdated: (user: PublicUser) => void;
}): React.JSX.Element {
  const [firstName, setFirstName] = useState(currentUser.firstName);
  const [lastName, setLastName] = useState(currentUser.lastName);
  const [profileBusy, setProfileBusy] = useState(false);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [scoreNotice, setScoreNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState<ScoringConfigDto | null>(null);
  const resource = usePersistedResource({
    scope: "workspace-scoring-settings",
    load: () => getScoringConfig(accessToken),
    accepts: (event) => event.entityType === "workspace",
    errorMessage: "Lead scoring settings could not be loaded."
  });

  useEffect(() => {
    if (resource.data) setScoreDraft(resource.data);
  }, [resource.data]);

  useEffect(() => {
    setFirstName(currentUser.firstName);
    setLastName(currentUser.lastName);
  }, [currentUser.firstName, currentUser.lastName]);

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setProfileBusy(true);
    setError(null);
    setProfileNotice("");
    try {
      const updated = await updateOwnProfile(accessToken, {
        firstName: firstName.trim(),
        lastName: lastName.trim()
      });
      onUserUpdated(updated);
      setProfileNotice("Your profile has been saved.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "Your profile could not be saved."));
    } finally {
      setProfileBusy(false);
    }
  };

  const saveScoring = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!scoreDraft) return;
    setScoreBusy(true);
    setError(null);
    setScoreNotice("");
    try {
      const saved = await updateScoringConfig(accessToken, {
        requirementWeight: scoreDraft.requirementWeight,
        authorityWeight: scoreDraft.authorityWeight,
        budgetWeight: scoreDraft.budgetWeight,
        timelineWeight: scoreDraft.timelineWeight,
        businessFitWeight: scoreDraft.businessFitWeight,
        warmThreshold: scoreDraft.warmThreshold,
        hotThreshold: scoreDraft.hotThreshold
      });
      setScoreDraft(saved);
      await resource.reload();
      setScoreNotice("Lead scoring settings have been saved.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "Lead scoring settings could not be saved."));
    } finally {
      setScoreBusy(false);
    }
  };

  return (
    <main className="admin-workspace">
      <header className="admin-page-header">
        <div>
          <span className="section-eyebrow">WORKSPACE / PREFERENCES</span>
          <h1>Settings</h1>
          <p>Update your profile and the shared rules used to prioritize new leads.</p>
        </div>
      </header>
      {error ? (
        <p className="admin-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card className="admin-settings-section">
        <div className="admin-section-heading">
          <div>
            <h2>Your profile</h2>
            <p>These details appear to teammates across the workspace.</p>
          </div>
          <Badge tone="accent">{workspaceRole(currentUser).replaceAll("_", " ")}</Badge>
        </div>
        <form
          className="admin-form-grid settings-profile-form"
          onSubmit={(event) => void saveProfile(event)}
        >
          <label>
            First name
            <input
              autoComplete="given-name"
              required
              maxLength={80}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              autoComplete="family-name"
              required
              maxLength={80}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          <label className="admin-field-full">
            Email address
            <input type="email" value={currentUser.email} readOnly />
          </label>
          <div className="admin-form-footer admin-field-full">
            {profileNotice ? (
              <span className="admin-success-text" role="status">
                {profileNotice}
              </span>
            ) : (
              <span />
            )}
            <Button
              variant="primary"
              type="submit"
              disabled={
                profileBusy ||
                (firstName === currentUser.firstName && lastName === currentUser.lastName)
              }
            >
              {profileBusy ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="admin-settings-section">
        <div className="admin-section-heading">
          <div>
            <h2>Lead prioritization</h2>
            <p>These shared rules affect how new leads are prioritized throughout the platform.</p>
          </div>
          <Badge tone={isWorkspaceAdmin(currentUser) ? "success" : "neutral"}>
            {isWorkspaceAdmin(currentUser) ? "Editable" : "Read only"}
          </Badge>
        </div>
        {resource.loading && !scoreDraft ? (
          <StateBlock
            title="Loading scoring rules"
            detail="Getting the saved workspace scoring settings."
          />
        ) : null}
        {resource.error && !scoreDraft ? (
          <StateBlock
            title="Scoring rules unavailable"
            detail={resource.error}
            action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          />
        ) : null}
        {scoreDraft ? (
          <form onSubmit={(event) => void saveScoring(event)}>
            <div className="admin-score-grid">
              {scoreFields.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <span className="admin-number-field">
                    <input
                      aria-label={`${label} weight`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={scoreDraft[key]}
                      disabled={!isWorkspaceAdmin(currentUser)}
                      onChange={(event) =>
                        setScoreDraft({ ...scoreDraft, [key]: Number(event.target.value) })
                      }
                    />
                    <span>points</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="admin-score-grid admin-score-thresholds">
              <label>
                Warm lead starts at
                <span className="admin-number-field">
                  <input
                    aria-label="Warm lead threshold"
                    type="number"
                    min={0}
                    max={100}
                    value={scoreDraft.warmThreshold}
                    disabled={!isWorkspaceAdmin(currentUser)}
                    onChange={(event) =>
                      setScoreDraft({ ...scoreDraft, warmThreshold: Number(event.target.value) })
                    }
                  />
                  <span>points</span>
                </span>
              </label>
              <label>
                High priority starts at
                <span className="admin-number-field">
                  <input
                    aria-label="High priority threshold"
                    type="number"
                    min={0}
                    max={100}
                    value={scoreDraft.hotThreshold}
                    disabled={!isWorkspaceAdmin(currentUser)}
                    onChange={(event) =>
                      setScoreDraft({ ...scoreDraft, hotThreshold: Number(event.target.value) })
                    }
                  />
                  <span>points</span>
                </span>
              </label>
            </div>
            <div className="admin-form-footer">
              {scoreNotice ? (
                <span className="admin-success-text" role="status">
                  {scoreNotice}
                </span>
              ) : (
                <span>Changes apply to future lead scoring.</span>
              )}
              {isWorkspaceAdmin(currentUser) ? (
                <Button variant="primary" type="submit" disabled={scoreBusy}>
                  {scoreBusy ? "Saving..." : "Save scoring rules"}
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Card>
      {isWorkspaceManager(currentUser) ? (
        <FollowUpPoliciesSection accessToken={accessToken} />
      ) : null}
      <section className="admin-settings-note">
        <strong>Workspace access</strong>
        <span>
          Team roles and account access are managed in <a href="/users">Users</a>. Provider
          connections remain in <a href="/integrations">Integrations</a>.
        </span>
      </section>
      <PrivacySection accessToken={accessToken} currentUser={currentUser} />
    </main>
  );
}
