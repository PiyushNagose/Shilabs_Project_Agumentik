import type React from "react";
import { formatDateTime } from "../../utils/date-time.js";
import { useEffect, useRef, useState } from "react";
import type { ContactDto, PublicUser } from "@shilabs/shared-types";
import { Download, Eye, Save, Trash2 } from "lucide-react";
import { Button, Modal, Select } from "../../components/ui/index.js";
import { listContacts } from "../../services/api/contacts.js";
import { StateBlock } from "../../components/StateBlock.js";
import { isWorkspaceAdmin, isWorkspaceManager } from "../auth/workspace-access.js";
import { apiErrorMessage } from "../../services/api/core.js";
import {
  applyPrivacyCleanup,
  eraseContactData,
  exportContactData,
  getPrivacyPolicy,
  privacyCategories,
  previewPrivacyCleanup,
  savePrivacyPolicy,
  type CleanupPreview,
  type PrivacyCategory,
  type PrivacyPolicy
} from "../../services/api/privacy.js";

const labels: Record<PrivacyCategory, string> = {
  email: "Email content",
  messages: "Message content",
  calls: "Call transcripts and recording links",
  providerPayloads: "Provider payloads",
  ai: "AI context and results",
  files: "Stored document content",
  audit: "Audit and activity details",
  deletedRecords: "Erased contact details"
};

export function PrivacySection({
  accessToken,
  currentUser,
  workspaceId
}: {
  accessToken: string;
  currentUser: PublicUser;
  workspaceId?: string;
}): React.JSX.Element | null {
  const admin = isWorkspaceAdmin(currentUser);
  const allowed = isWorkspaceManager(currentUser);
  const [policy, setPolicy] = useState<PrivacyPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [eraseId, setEraseId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setPolicy(null);
    setPreview(null);
    setConfirmCleanup(false);
    setContactId("");
    setContacts([]);
    setEraseId(null);
    setError(null);
    setNotice("");
    setDirty(false);
    setBusy(false);
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([getPrivacyPolicy(accessToken), listContacts(accessToken)])
      .then(([value, contactList]) => {
        if (generation.current === current) {
          setPolicy(value);
          setContacts(contactList);
        }
      })
      .catch((cause: unknown) => {
        if (generation.current === current)
          setError(apiErrorMessage(cause, "Privacy settings could not be loaded."));
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [accessToken, workspaceId, currentUser.id, currentUser.workspaceRole, allowed, attempt]);

  if (!allowed) return null;
  const run = async (action: () => Promise<void>): Promise<void> => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (generation.current === current)
        setError(apiErrorMessage(cause, "The privacy request could not be completed."));
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  const change = (next: PrivacyPolicy): void => {
    setPolicy(next);
    setDirty(true);
    setPreview(null);
  };
  const save = (): void => {
    if (policy)
      void run(async () => {
        const current = generation.current;
        const value = await savePrivacyPolicy(accessToken, policy);
        if (generation.current !== current) return;
        setPolicy(value);
        setDirty(false);
        setPreview(null);
        setNotice("Privacy settings saved.");
      });
  };
  const download = (): void => {
    void run(async () => {
      const current = generation.current;
      const value = await exportContactData(accessToken, contactId.trim());
      if (generation.current !== current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "contact-export.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Contact export downloaded.");
    });
  };

  return (
    <section className="ui-card admin-settings-section" aria-labelledby="privacy-heading">
      <div className="admin-section-heading">
        <div>
          <h2 id="privacy-heading">Privacy and retention</h2>
          <p>
            Remove stored content after a chosen number of days. Blank periods keep content
            indefinitely.
          </p>
          <p>
            Cleanup keeps record identifiers, dates, and audit history. Provider-held copies need
            separate deletion through the provider.
          </p>
        </div>
      </div>
      {loading ? (
        <StateBlock
          title="Loading privacy settings"
          detail="Getting this workspace's saved policy."
        />
      ) : null}
      {error ? (
        <p className="admin-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !policy ? (
        <Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {policy ? (
        <>
          <form
            className="admin-form-grid privacy-policy-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="admin-field-full">
              <input
                type="checkbox"
                checked={policy.enabled}
                disabled={!admin || busy}
                onChange={(event) => change({ ...policy, enabled: event.target.checked })}
              />{" "}
              Allow scheduled cleanup
            </label>
            {privacyCategories.map((category) => (
              <label key={category}>
                {labels[category]} (days)
                <input
                  type="number"
                  min={1}
                  max={36500}
                  step={1}
                  value={policy.periods[category] ?? ""}
                  disabled={!admin || busy}
                  onChange={(event) =>
                    change({
                      ...policy,
                      periods: {
                        ...policy.periods,
                        [category]: event.target.value === "" ? null : Number(event.target.value)
                      }
                    })
                  }
                />
              </label>
            ))}
            {admin ? (
              <div className="admin-form-footer admin-field-full">
                <Button type="submit" variant="primary" disabled={busy || !dirty}>
                  <Save size={16} /> Save policy
                </Button>
                <Button
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      const current = generation.current;
                      const value = await previewPrivacyCleanup(accessToken);
                      if (generation.current === current) setPreview(value);
                    })
                  }
                >
                  <Eye size={16} /> Preview cleanup
                </Button>
              </div>
            ) : null}
          </form>
          {preview ? (
            <div aria-label="Cleanup preview">
              <h3>Content ready for cleanup</h3>
              <dl>
                {privacyCategories.map((category) => (
                  <div key={category}>
                    <dt>{labels[category]}</dt>
                    <dd>{preview.counts[category]}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Preview expires at {formatDateTime(preview.expiresAt)}. Cleanup cannot be undone.
              </p>
              {preview.hasMore ? (
                <p>This is one batch. Preview again after cleanup to review remaining content.</p>
              ) : null}
              <Button
                variant="danger"
                disabled={busy || !Object.values(preview.counts).some(Boolean)}
                onClick={() => setConfirmCleanup(true)}
              >
                <Trash2 size={16} /> Apply cleanup
              </Button>
            </div>
          ) : null}
          <section className="privacy-contact-section" aria-labelledby="contact-data-heading">
            <header>
              <h3 id="contact-data-heading">Contact data</h3>
              <p>
                Export a contact's stored business data, or erase personal details and stop their
                automation. Erased contacts stay marked do not contact.
              </p>
            </header>
            <label className="privacy-contact-field">
              Contact
              <Select
                ariaLabel="Contact"
                value={contactId}
                disabled={busy || contacts.length === 0}
                onChange={setContactId}
                options={[
                  { value: "", label: "Select contact" },
                  ...contacts.map((contact) => ({
                    value: contact.id,
                    label: `${contact.firstName} ${contact.lastName}${contact.email ? ` (${contact.email})` : ""}`
                  }))
                ]}
              />
            </label>
            {contacts.length === 0 ? <p>No contacts are available in this workspace.</p> : null}
            <div className="privacy-contact-actions">
              <Button disabled={busy || !contactId.trim()} onClick={download}>
                <Download size={16} /> Export contact
              </Button>
              {admin ? (
                <Button
                  variant="danger"
                  disabled={busy || !contactId.trim()}
                  onClick={() => {
                    setConfirmation("");
                    setEraseId(contactId.trim());
                  }}
                >
                  <Trash2 size={16} /> Erase contact
                </Button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      <Modal
        open={confirmCleanup}
        title="Apply content cleanup"
        onClose={() => {
          if (!busy) setConfirmCleanup(false);
        }}
      >
        <p>
          Permanently remove content from{" "}
          {preview ? Object.values(preview.counts).reduce((sum, count) => sum + count, 0) : 0}{" "}
          records in this preview? This cannot be undone.
        </p>
        {error ? (
          <p role="alert" className="admin-inline-error">
            {error}
          </p>
        ) : null}
        <div className="admin-form-footer">
          <Button disabled={busy} onClick={() => setConfirmCleanup(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || !preview}
            onClick={() => {
              if (!preview) return;
              void run(async () => {
                const current = generation.current;
                const result = await applyPrivacyCleanup(accessToken, preview.previewId);
                if (generation.current === current) {
                  setConfirmCleanup(false);
                  setPreview(null);
                  setNotice(`Cleaned content from ${String(result.cleaned)} records.`);
                }
              });
            }}
          >
            <Trash2 size={16} /> {busy ? "Cleaning..." : "Apply cleanup"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={eraseId !== null}
        title="Erase contact data"
        onClose={() => {
          if (!busy) setEraseId(null);
        }}
      >
        <p>
          Erase personal details for {contacts.find((contact) => contact.id === eraseId)?.firstName}{" "}
          {contacts.find((contact) => contact.id === eraseId)?.lastName}. This cannot be undone.
          Automation will stop and the contact will be marked do not contact.
        </p>
        <label>
          Type ERASE CONTACT to confirm
          <input
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        {error ? (
          <p role="alert" className="admin-inline-error">
            {error}
          </p>
        ) : null}
        <div className="admin-form-footer">
          <Button disabled={busy} onClick={() => setEraseId(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || confirmation !== "ERASE CONTACT"}
            onClick={() => {
              if (!eraseId) return;
              void run(async () => {
                const current = generation.current;
                const result = await eraseContactData(accessToken, eraseId);
                if (generation.current === current) {
                  setContacts((values) => values.filter((contact) => contact.id !== eraseId));
                  setContactId("");
                  setEraseId(null);
                  setPreview(null);
                  setNotice(`Contact data erased. ${result.externalCopies}`);
                }
              });
            }}
          >
            <Trash2 size={16} /> {busy ? "Erasing..." : "Erase contact"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
