import type React from "react";
import { useEffect, useState } from "react";
import type { LeadDocumentKindName, LeadIntelligenceDto, PublicUser } from "@shilabs/shared-types";
import {
  BrainCircuit,
  FileText,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2
} from "lucide-react";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import {
  createLeadIntelligenceDocument,
  decideLeadFollowUp,
  deleteLeadIntelligenceDocument,
  getLeadIntelligence,
  refreshLeadIntelligence,
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
  const [documentOpen, setDocumentOpen] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentKind, setDocumentKind] = useState<LeadDocumentKindName>("AUDIT");
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
    } catch {
      setError("The intelligence update could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  const saveDocument = async (): Promise<void> => {
    await run(async () => {
      await createLeadIntelligenceDocument(accessToken, leadId, {
        title: documentTitle,
        kind: documentKind,
        sourceType: documentUrl ? "LINK" : "UPLOAD",
        sourceUrl: documentUrl || undefined,
        mimeType: "text/plain",
        content: documentContent || undefined
      });
      setDocumentOpen(false);
      setDocumentTitle("");
      setDocumentUrl("");
      setDocumentContent("");
    });
  };
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
          <h4>{decision?.reason ?? "Run a recommendation against current grounded context."}</h4>
          <p>{decision?.nextObjective ?? data.nextObjective}</p>
          {decision?.guardrailCode ? (
            <small>{decision.guardrailCode.replaceAll("_", " ")}</small>
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
          <Select
            ariaLabel="Follow-up mode"
            disabled={!canManage || busy}
            options={modeOptions}
            value={data.followUpMode}
            onChange={(value) =>
              void run(() =>
                updateLeadIntelligenceControls(accessToken, leadId, {
                  followUpMode: value as LeadIntelligenceDto["followUpMode"]
                })
              )
            }
          />
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
          {canManage ? (
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
              {data.humanInterventionRequired ? "Clear human flag" : "Require human"}
            </Button>
          ) : null}
        </div>
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
                    {document.kind} / {document.status} / {document.chunkCount} evidence chunks
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
      <Modal open={documentOpen} title="Add lead document" onClose={() => setDocumentOpen(false)}>
        <div className="lead-document-form">
          <label>
            <span>Title</span>
            <input
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
          <label>
            <span>Source link</span>
            <input
              type="url"
              placeholder="https://"
              value={documentUrl}
              onChange={(event) => setDocumentUrl(event.target.value)}
            />
          </label>
          <label>
            <span>Extracted text</span>
            <textarea
              rows={8}
              value={documentContent}
              onChange={(event) => setDocumentContent(event.target.value)}
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || !documentTitle.trim()}
            onClick={() => void saveDocument()}
          >
            Index document
          </Button>
        </div>
      </Modal>
    </section>
  );
}
