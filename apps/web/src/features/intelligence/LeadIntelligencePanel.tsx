import type React from "react";
import { useEffect, useState } from "react";
import type { LeadDocumentKindName, LeadIntelligenceDto, PublicUser } from "@shilabs/shared-types";
import {
  BrainCircuit,
  FileText,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2
} from "lucide-react";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import {
  createLeadIntelligenceDocument,
  apiErrorMessage,
  decideLeadFollowUp,
  deleteLeadIntelligenceDocument,
  getLeadIntelligence,
  refreshLeadIntelligence,
  uploadLeadIntelligenceDocument,
  updateLeadIntelligenceControls
} from "../../services/api-client.js";
import { useRealtime } from "../realtime/RealtimeProvider.js";

const aiOptions = [
  { value: "ON", label: "AI on" },
  { value: "PAUSED", label: "AI paused" },
  { value: "OFF", label: "AI off" }
];
const modeOptions = [
  { value: "STANDARD", label: "Standard" },
  { value: "AGGRESSIVE", label: "Aggressive" },
  { value: "LOW_FREQUENCY", label: "Low frequency" },
  { value: "HIGH_VALUE", label: "High value" },
  { value: "CUSTOM", label: "Custom" }
];
const channelOptions = [
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "PHONE", label: "Phone" },
  { value: "MIXED", label: "Mixed" }
];
const documentOptions = [
  "AUDIT",
  "REPORT",
  "PROPOSAL",
  "PRICING",
  "PRESENTATION",
  "RESEARCH",
  "OTHER"
].map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }));
const documentSourceOptions = [
  { value: "UPLOAD", label: "Upload a file" },
  { value: "PASTE", label: "Paste text" },
  { value: "LINK", label: "Add a source link" }
];
type DocumentSourceMode = "UPLOAD" | "PASTE" | "LINK";

const safeguardLabels: Record<string, string> = {
  AI_CONTROL_OFF: "AI follow-up is switched off",
  AI_CONTROL_PAUSED: "AI follow-up is paused",
  DO_NOT_CONTACT: "Do not contact",
  HIGH_RISK_CLIENT_CONTEXT: "Pricing, legal, or high-risk request",
  HUMAN_REQUIRED: "Human response required",
  OWNERSHIP_BLOCKED: "Waiting for the responsible person"
};
const documentStatusLabels: Record<string, string> = {
  ARCHIVED: "Archived",
  FAILED: "Needs attention",
  INDEXED: "Ready",
  NEEDS_CONTENT: "Content required"
};

function readableDocumentKind(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function readableDecisionReason(value: string): string {
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, (timestamp) =>
    new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(new Date(timestamp))
  );
}

function isLeadIntelligence(value: unknown): value is LeadIntelligenceDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LeadIntelligenceDto>;
  return (
    typeof candidate.leadId === "string" &&
    Array.isArray(candidate.documents) &&
    Array.isArray(candidate.objections) &&
    Array.isArray(candidate.commitments)
  );
}

export function LeadIntelligencePanel({
  accessToken,
  currentUser,
  leadId
}: {
  accessToken: string;
  currentUser: PublicUser;
  leadId: string;
}): React.JSX.Element {
  const [data, setData] = useState<LeadIntelligenceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customCadence, setCustomCadence] = useState("");
  const savedCustomCadence = data?.customCadenceDays.join(", ") ?? "";
  useEffect(() => {
    setCustomCadence(savedCustomCadence);
  }, [leadId, savedCustomCadence]);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentKind, setDocumentKind] = useState<LeadDocumentKindName>("AUDIT");
  const [documentSourceMode, setDocumentSourceMode] = useState<DocumentSourceMode>("UPLOAD");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentUrl, setDocumentUrl] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const realtime = useRealtime();
  const canManage = currentUser.role === "ADMIN" || currentUser.role === "SALES_MANAGER";
  const load = async (): Promise<void> => {
    try {
      const result: unknown = await getLeadIntelligence(accessToken, leadId);
      if (!isLeadIntelligence(result)) throw new Error("Invalid lead intelligence response");
      setData(result);
      setError(null);
    } catch {
      setError("Lead intelligence could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setLoading(true);
    void load();
  }, [accessToken, leadId]);
  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (
          event.leadId === leadId &&
          ["lead", "activity", "task", "deal", "proposal", "meeting"].includes(event.entityType)
        )
          void load();
      }),
    [leadId, realtime.subscribe]
  );
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (operationError) {
      setError(apiErrorMessage(operationError, "The intelligence update could not be completed."));
    } finally {
      setBusy(false);
    }
  };
  const saveCustomCadence = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parts = customCadence.split(",").map((value) => value.trim());
    const days = [...new Set(parts.map(Number))].sort((left, right) => left - right);
    if (
      parts.some((value) => !/^\d+$/.test(value)) ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 365) ||
      days.length > 20
    ) {
      setError("Enter 1 to 20 positive whole day numbers from 1 to 365, for example 2, 5, 8.");
      return;
    }
    void run(() =>
      updateLeadIntelligenceControls(accessToken, leadId, {
        followUpMode: "CUSTOM",
        customCadenceDays: days
      })
    );
  };
  const resetDocumentForm = (): void => {
    setDocumentOpen(false);
    setDocumentTitle("");
    setDocumentKind("AUDIT");
    setDocumentSourceMode("UPLOAD");
    setDocumentFile(null);
    setDocumentUrl("");
    setDocumentContent("");
  };
  const saveDocument = async (): Promise<void> => {
    await run(async () => {
      if (documentSourceMode === "UPLOAD" && documentFile) {
        await uploadLeadIntelligenceDocument(accessToken, leadId, {
          title: documentTitle.trim(),
          kind: documentKind,
          file: documentFile
        });
      } else {
        await createLeadIntelligenceDocument(accessToken, leadId, {
          title: documentTitle.trim(),
          kind: documentKind,
          sourceType: documentSourceMode === "LINK" ? "LINK" : "UPLOAD",
          sourceUrl: documentSourceMode === "LINK" ? documentUrl.trim() : undefined,
          mimeType: documentSourceMode === "PASTE" ? "text/plain" : undefined,
          content: documentSourceMode === "PASTE" ? documentContent.trim() : undefined
        });
      }
      resetDocumentForm();
    });
  };
  const documentReady =
    Boolean(documentTitle.trim()) &&
    (documentSourceMode === "UPLOAD"
      ? Boolean(documentFile)
      : documentSourceMode === "PASTE"
        ? Boolean(documentContent.trim())
        : Boolean(documentUrl.trim()));
  if (loading && !data) return <StateBlock title="Loading lead intelligence" />;
  if (!data)
    return (
      <StateBlock
        title="Lead intelligence unavailable"
        detail={error ?? undefined}
        action={<Button onClick={() => void load()}>Retry</Button>}
      />
    );
  const decision = data.latestDecision;
  return (
    <section className="lead-intelligence-section" aria-label="Lead intelligence">
      <header className="lead-intelligence-header">
        <div>
          <span className="section-eyebrow">LEAD MEMORY</span>
          <h3>Client intelligence</h3>
          <p>
            Grounded context from communication, activity, commercial history and indexed documents.
          </p>
        </div>
        <div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => refreshLeadIntelligence(accessToken, leadId))}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void run(() => decideLeadFollowUp(accessToken, leadId))}
          >
            <Sparkles size={14} /> Recommend
          </Button>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="lead-intelligence-grid">
        <Card className="lead-memory-card">
          <header>
            <BrainCircuit size={18} />
            <Badge>{data.healthScore} health</Badge>
          </header>
          <h4>{data.summary ?? "Context is still being established"}</h4>
          <dl>
            <div>
              <dt>Primary need</dt>
              <dd>{data.primaryNeed ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Next objective</dt>
              <dd>{data.nextObjective ?? "Review lead"}</dd>
            </div>
            <div>
              <dt>Communication style</dt>
              <dd>{data.communicationStyle ?? "Unknown"}</dd>
            </div>
          </dl>
          {data.evidence.length > 0 ? (
            <section className="lead-grounded-facts" aria-label="Grounded facts">
              <span className="section-eyebrow">GROUNDED FACTS</span>
              <ul>
                {data.evidence.slice(0, 4).map((item, index) => (
                  <li key={`${item.sourceType}-${item.sourceId}-${String(index)}`}>
                    <strong>{item.title}</strong>
                    <span>{item.quote}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </Card>
        <Card className="lead-recommendation-card">
          <header>
            <ShieldAlert size={18} />
            <Badge
              tone={
                decision?.decision === "ESCALATE" || decision?.decision === "ASK_HUMAN"
                  ? "danger"
                  : "warning"
              }
            >
              {decision?.decision.replaceAll("_", " ") ?? "NOT ASSESSED"}
            </Badge>
          </header>
          <h4>
            {decision
              ? readableDecisionReason(decision.reason)
              : "Run a recommendation against current grounded context."}
          </h4>
          <p>{decision?.nextObjective ?? data.nextObjective}</p>
          {decision?.guardrailCode ? (
            <small>
              {safeguardLabels[decision.guardrailCode] ?? "Protected by sales safeguards"}
            </small>
          ) : null}
        </Card>
      </div>
      <Card className="lead-control-card">
        <header>
          <div>
            <span className="section-eyebrow">AI CONTROLS</span>
            <h4>Follow-up policy</h4>
          </div>
          <Badge tone={data.humanInterventionRequired ? "danger" : "neutral"}>
            {data.humanInterventionRequired ? "HUMAN REQUIRED" : "STANDARD GUARDRAILS"}
          </Badge>
        </header>
        <div className="lead-control-grid">
          <div className="lead-control-field">
            <span>AI status</span>
            <Select
              ariaLabel="Lead AI status"
              disabled={!canManage || busy}
              options={aiOptions}
              value={data.aiControlStatus}
              onChange={(value) =>
                void run(() =>
                  updateLeadIntelligenceControls(accessToken, leadId, {
                    aiControlStatus: value as LeadIntelligenceDto["aiControlStatus"]
                  })
                )
              }
            />
          </div>
          <div className="lead-control-field">
            <span>Follow-up pace</span>
            <Select
              ariaLabel="Follow-up mode"
              disabled={!canManage || busy}
              options={modeOptions}
              value={data.followUpMode}
              onChange={(value) =>
                void run(() =>
                  updateLeadIntelligenceControls(accessToken, leadId, {
                    followUpMode: value as LeadIntelligenceDto["followUpMode"],
                    ...(value === "CUSTOM"
                      ? {
                          customCadenceDays:
                            data.customCadenceDays.length > 0 ? data.customCadenceDays : [2, 5, 8]
                        }
                      : {})
                  })
                )
              }
            />
          </div>
          <div className="lead-control-field">
            <span>Preferred channel</span>
            <Select
              ariaLabel="Preferred channel"
              disabled={!canManage || busy}
              options={channelOptions}
              value={data.preferredChannel}
              onChange={(value) =>
                void run(() =>
                  updateLeadIntelligenceControls(accessToken, leadId, {
                    preferredChannel: value as LeadIntelligenceDto["preferredChannel"]
                  })
                )
              }
            />
          </div>
          {canManage ? (
            <div className="lead-control-field">
              <span>Human review</span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    updateLeadIntelligenceControls(accessToken, leadId, {
                      humanInterventionRequired: !data.humanInterventionRequired
                    })
                  )
                }
              >
                {data.humanInterventionRequired ? "Clear requirement" : "Require human"}
              </Button>
            </div>
          ) : null}
        </div>
        {data.followUpMode === "CUSTOM" ? (
          <form className="admin-form-grid" onSubmit={saveCustomCadence}>
            <label>
              Custom follow-up days
              <input
                value={customCadence}
                placeholder="2, 5, 8"
                disabled={!canManage || busy}
                onChange={(event) => setCustomCadence(event.target.value)}
              />
            </label>
            {canManage ? (
              <div className="lead-control-field">
                <Button type="submit" disabled={busy || customCadence === savedCustomCadence}>
                  <Save size={14} /> Save cadence
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Card>
      <Card className="lead-evidence-card">
        <header>
          <div>
            <span className="section-eyebrow">DOCUMENT INTELLIGENCE</span>
            <h4>Grounded sources</h4>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setDocumentOpen(true)}>
              <Plus size={14} /> Add document
            </Button>
          ) : null}
        </header>
        {data.documents.length === 0 ? (
          <StateBlock
            title="No lead documents"
            detail="Add audit, report, proposal, pricing or research text for grounded retrieval."
          />
        ) : (
          <div className="lead-document-list">
            {data.documents.map((document) => (
              <article key={document.id}>
                <FileText size={17} />
                <div>
                  <strong>{document.title}</strong>
                  <span>
                    {readableDocumentKind(document.kind)} / {documentStatusLabels[document.status]}{" "}
                    / {document.chunkCount} evidence{" "}
                    {document.chunkCount === 1 ? "section" : "sections"}
                  </span>
                </div>
                {canManage ? (
                  <Button
                    aria-label={`Delete ${document.title}`}
                    iconOnly
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        deleteLeadIntelligenceDocument(accessToken, leadId, document.id)
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Card>
      {data.objections.length || data.commitments.length ? (
        <div className="lead-signal-grid">
          <Card>
            <span className="section-eyebrow">OBJECTIONS</span>
            {data.objections.length ? (
              data.objections.map((item) => <p key={item}>{item}</p>)
            ) : (
              <p>None grounded</p>
            )}
          </Card>
          <Card>
            <span className="section-eyebrow">COMMITMENTS</span>
            {data.commitments.length ? (
              data.commitments.map((item) => <p key={item}>{item}</p>)
            ) : (
              <p>None grounded</p>
            )}
          </Card>
        </div>
      ) : null}
      <Modal open={documentOpen} title="Add lead document" onClose={resetDocumentForm}>
        <div className="lead-document-form">
          <div className="lead-document-fields">
            <label>
              <span>Title</span>
              <input
                autoFocus
                placeholder="Document title"
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
              />
            </label>
            <label>
              <span>Document type</span>
              <Select
                ariaLabel="Document type"
                options={documentOptions}
                value={documentKind}
                onChange={(value) => setDocumentKind(value as LeadDocumentKindName)}
              />
            </label>
            <label className="lead-document-wide">
              <span>Add document by</span>
              <Select
                ariaLabel="Document source"
                options={documentSourceOptions}
                value={documentSourceMode}
                onChange={(value) => setDocumentSourceMode(value as DocumentSourceMode)}
              />
            </label>
            {documentSourceMode === "UPLOAD" ? (
              <label className="lead-document-wide">
                <span>
                  Document file <small>PDF, DOCX, or TXT; maximum 10 MB</small>
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setDocumentFile(file);
                    if (file && !documentTitle.trim()) {
                      setDocumentTitle(file.name.replace(/\.[^.]+$/u, ""));
                    }
                  }}
                />
              </label>
            ) : null}
            {documentSourceMode === "LINK" ? (
              <label className="lead-document-wide">
                <span>Source link</span>
                <input
                  type="url"
                  placeholder="https://example.com/document"
                  value={documentUrl}
                  onChange={(event) => setDocumentUrl(event.target.value)}
                />
              </label>
            ) : null}
            {documentSourceMode === "PASTE" ? (
              <label className="lead-document-wide">
                <span>Document text</span>
                <textarea
                  rows={7}
                  placeholder="Paste the approved document content to index"
                  value={documentContent}
                  onChange={(event) => setDocumentContent(event.target.value)}
                />
              </label>
            ) : null}
          </div>
          <footer>
            <Button disabled={busy} onClick={resetDocumentForm}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !documentReady}
              onClick={() => void saveDocument()}
            >
              Index document
            </Button>
          </footer>
        </div>
      </Modal>
    </section>
  );
}
