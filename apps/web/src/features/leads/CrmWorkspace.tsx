import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CONVERSATION_MODES,
  type ActivityDto,
  type ConversationDto,
  type ConversationModeName,
  type LeadDto,
  type LeadTemperatureName,
  type MessageDto,
  type PaginatedResponse,
  type PipelineStageDto,
  type ProposalDto,
  type ProposalSendResultDto,
  type PublicUser
} from "@shilabs/shared-types";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import {
  assignLead,
  appendConversationMessage,
  approveProposal,
  createConversation,
  getLead,
  listConversationMessages,
  listConversations,
  listLeadActivities,
  listLeads,
  listPipelineStages,
  listProposals,
  listUsers,
  sendApprovedProposal,
  updateConversationMode,
  updateLeadStage,
  updateProposalDraft,
  type LeadListParams
} from "../../services/api-client.js";

type WorkspaceView = "leads" | "pipeline";
type DetailTab =
  | "Overview"
  | "Conversation"
  | "Qualification"
  | "Proposals"
  | "Activities"
  | "Meetings"
  | "Deal"
  | "AI Insights";

const detailTabs: DetailTab[] = [
  "Overview",
  "Conversation",
  "Qualification",
  "Proposals",
  "Activities",
  "Meetings",
  "Deal",
  "AI Insights"
];

interface CrmWorkspaceProps {
  accessToken: string;
  currentUser: PublicUser;
}

interface WorkspaceState {
  leadsPage: PaginatedResponse<LeadDto> | null;
  stages: PipelineStageDto[];
  users: PublicUser[];
  selectedLead: LeadDto | null;
  activities: ActivityDto[];
  loading: boolean;
  error: string | null;
}

interface ConversationState {
  conversations: ConversationDto[];
  selectedConversation: ConversationDto | null;
  messages: MessageDto[];
  input: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface ProposalState {
  proposals: ProposalDto[];
  selectedProposalId: string | null;
  draftTitle: string;
  draftContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  sendResult: ProposalSendResultDto | null;
}

const initialFilters: LeadListParams = {
  page: 1,
  pageSize: 10,
  sort: "lastActivityAt",
  direction: "desc"
};

const initialConversationState: ConversationState = {
  conversations: [],
  selectedConversation: null,
  messages: [],
  input: "",
  loading: false,
  saving: false,
  error: null
};

const initialProposalState: ProposalState = {
  proposals: [],
  selectedProposalId: null,
  draftTitle: "",
  draftContent: "",
  loading: false,
  saving: false,
  error: null,
  sendResult: null
};

function formatDate(value: string | null): string {
  if (!value) {
    return "No activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMoney(value: string | null, currency: string): string {
  if (!value) {
    return "Value unknown";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency
  }).format(Number(value));
}

function temperatureTone(temperature: LeadTemperatureName): "hot" | "warm" | "neutral" {
  if (temperature === "HOT") {
    return "hot";
  }

  if (temperature === "WARM") {
    return "warm";
  }

  return "neutral";
}

export function CrmWorkspace({ accessToken, currentUser }: CrmWorkspaceProps): React.JSX.Element {
  const [view, setView] = useState<WorkspaceView>("leads");
  const [activeTab, setActiveTab] = useState<DetailTab>("Overview");
  const [filters, setFilters] = useState<LeadListParams>(initialFilters);
  const [state, setState] = useState<WorkspaceState>({
    leadsPage: null,
    stages: [],
    users: [],
    selectedLead: null,
    activities: [],
    loading: true,
    error: null
  });
  const [conversationState, setConversationState] =
    useState<ConversationState>(initialConversationState);
  const [proposalState, setProposalState] = useState<ProposalState>(initialProposalState);

  async function loadWorkspace(
    nextFilters = filters,
    leadId = state.selectedLead?.id
  ): Promise<void> {
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const [leadsPage, stages, users] = await Promise.all([
        listLeads(accessToken, nextFilters),
        listPipelineStages(accessToken),
        listUsers(accessToken).catch(() => [currentUser])
      ]);
      const selectedLead =
        leadId !== undefined
          ? await getLead(accessToken, leadId).catch(() => leadsPage.items[0] ?? null)
          : (leadsPage.items[0] ?? null);
      const activities = selectedLead
        ? await listLeadActivities(accessToken, selectedLead.id).catch(() => [])
        : [];

      setState({
        leadsPage,
        stages,
        users,
        selectedLead,
        activities,
        loading: false,
        error: null
      });
    } catch {
      setState((current) => ({
        ...current,
        loading: false,
        error: "CRM data could not be loaded"
      }));
    }
  }

  useEffect(() => {
    void loadWorkspace(initialFilters);
  }, [accessToken]);

  useEffect(() => {
    if (activeTab === "Conversation" && state.selectedLead) {
      void loadLeadConversations(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  useEffect(() => {
    if (activeTab === "Proposals" && state.selectedLead) {
      void loadLeadProposals(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  async function loadLeadConversations(leadId: string): Promise<void> {
    setConversationState((current) => ({ ...current, loading: true, error: null }));

    try {
      const conversations = await listConversations(accessToken, { leadId });
      const selectedConversation = conversations[0] ?? null;
      const messages = selectedConversation
        ? await listConversationMessages(accessToken, selectedConversation.id)
        : [];

      setConversationState((current) => ({
        ...current,
        conversations,
        selectedConversation,
        messages,
        loading: false,
        error: null
      }));
    } catch {
      setConversationState((current) => ({
        ...current,
        loading: false,
        error: "Conversation data could not be loaded"
      }));
    }
  }

  async function loadLeadProposals(leadId: string): Promise<void> {
    setProposalState((current) => ({ ...current, loading: true, error: null }));

    try {
      const proposals = await listProposals(accessToken, { leadId, limit: 50 });
      const selectedProposal =
        proposals.find((proposal) => proposal.id === proposalState.selectedProposalId) ??
        proposals[0] ??
        null;

      setProposalState((current) => ({
        ...current,
        proposals,
        selectedProposalId: selectedProposal?.id ?? null,
        draftTitle: selectedProposal?.title ?? "",
        draftContent: selectedProposal?.currentVersion?.content ?? "",
        loading: false,
        saving: false,
        error: null,
        sendResult: null
      }));
    } catch {
      setProposalState((current) => ({
        ...current,
        loading: false,
        saving: false,
        error: "Proposals could not be loaded"
      }));
    }
  }

  const leads = state.leadsPage?.items ?? [];
  const groupedLeads = useMemo(
    () =>
      state.stages.map((stage) => ({
        stage,
        leads: leads.filter((lead) => lead.stageId === stage.id)
      })),
    [leads, state.stages]
  );

  async function applyFilters(nextFilters: LeadListParams): Promise<void> {
    const merged = { ...filters, ...nextFilters, page: nextFilters.page ?? 1 };
    setFilters(merged);
    await loadWorkspace(merged);
  }

  async function selectLead(leadId: string): Promise<void> {
    const lead = await getLead(accessToken, leadId);
    const activities = await listLeadActivities(accessToken, leadId).catch(() => []);
    setState((current) => ({ ...current, selectedLead: lead, activities }));
    setConversationState(initialConversationState);
    setProposalState(initialProposalState);
  }

  async function persistStage(stageId: string): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    const lead = await updateLeadStage(accessToken, state.selectedLead.id, stageId);
    setState((current) => ({
      ...current,
      selectedLead: lead,
      leadsPage: current.leadsPage
        ? {
            ...current.leadsPage,
            items: current.leadsPage.items.map((item) => (item.id === lead.id ? lead : item))
          }
        : current.leadsPage
    }));
    await loadWorkspace(filters, lead.id);
  }

  async function persistOwner(ownerId: string): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    const lead = await assignLead(accessToken, state.selectedLead.id, ownerId || null);
    setState((current) => ({
      ...current,
      selectedLead: lead,
      leadsPage: current.leadsPage
        ? {
            ...current.leadsPage,
            items: current.leadsPage.items.map((item) => (item.id === lead.id ? lead : item))
          }
        : current.leadsPage
    }));
  }

  async function startSimulatorConversation(): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));

    try {
      const conversation = await createConversation(accessToken, {
        leadId: state.selectedLead.id,
        channel: "WEBSITE",
        mode: "AUTO"
      });
      setConversationState((current) => ({
        ...current,
        conversations: [conversation, ...current.conversations],
        selectedConversation: conversation,
        messages: [],
        saving: false,
        error: null
      }));
    } catch {
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: "Conversation could not be started"
      }));
    }
  }

  async function selectConversation(conversationId: string): Promise<void> {
    const selectedConversation =
      conversationState.conversations.find((conversation) => conversation.id === conversationId) ??
      null;

    if (!selectedConversation) {
      return;
    }

    setConversationState((current) => ({
      ...current,
      selectedConversation,
      loading: true,
      error: null
    }));

    try {
      const messages = await listConversationMessages(accessToken, selectedConversation.id);
      setConversationState((current) => ({
        ...current,
        messages,
        loading: false,
        error: null
      }));
    } catch {
      setConversationState((current) => ({
        ...current,
        loading: false,
        error: "Conversation messages could not be loaded"
      }));
    }
  }

  async function persistConversationMode(mode: ConversationModeName): Promise<void> {
    if (!conversationState.selectedConversation) {
      return;
    }

    const conversation = await updateConversationMode(
      accessToken,
      conversationState.selectedConversation.id,
      mode
    );
    setConversationState((current) => ({
      ...current,
      selectedConversation: conversation,
      conversations: current.conversations.map((item) =>
        item.id === conversation.id ? conversation : item
      )
    }));
  }

  async function sendProspectMessage(): Promise<void> {
    if (!state.selectedLead || !conversationState.selectedConversation) {
      return;
    }

    const body = conversationState.input.trim();
    if (!body) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));

    try {
      const message = await appendConversationMessage(
        accessToken,
        conversationState.selectedConversation.id,
        {
          direction: "INBOUND",
          senderType: "PROSPECT",
          body
        }
      );
      const activities = await listLeadActivities(accessToken, state.selectedLead.id).catch(
        () => state.activities
      );
      setState((current) => ({ ...current, activities }));
      setConversationState((current) => ({
        ...current,
        messages: [...current.messages, message],
        input: "",
        saving: false,
        error: null
      }));
    } catch {
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: "Message could not be saved"
      }));
    }
  }

  function selectProposal(proposalId: string): void {
    const proposal = proposalState.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    setProposalState((current) => ({
      ...current,
      selectedProposalId: proposal.id,
      draftTitle: proposal.title,
      draftContent: proposal.currentVersion?.content ?? "",
      sendResult: null,
      error: null
    }));
  }

  async function saveProposalDraft(): Promise<void> {
    if (!state.selectedLead || !proposalState.selectedProposalId) {
      return;
    }

    setProposalState((current) => ({ ...current, saving: true, error: null }));

    try {
      const proposal = await updateProposalDraft(accessToken, proposalState.selectedProposalId, {
        title: proposalState.draftTitle,
        content: proposalState.draftContent,
        editSummary: "Updated from proposal review UI"
      });
      setProposalState((current) => ({
        ...current,
        proposals: current.proposals.map((item) => (item.id === proposal.id ? proposal : item)),
        selectedProposalId: proposal.id,
        draftTitle: proposal.title,
        draftContent: proposal.currentVersion?.content ?? "",
        saving: false,
        error: null
      }));
      setState((current) => ({ ...current, activities: current.activities }));
    } catch {
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: "Draft could not be saved"
      }));
    }
  }

  async function approveSelectedProposal(): Promise<void> {
    if (!proposalState.selectedProposalId) {
      return;
    }

    setProposalState((current) => ({ ...current, saving: true, error: null }));

    try {
      const proposal = await approveProposal(accessToken, proposalState.selectedProposalId, {
        reason: "Approved from proposal review UI"
      });
      setProposalState((current) => ({
        ...current,
        proposals: current.proposals.map((item) => (item.id === proposal.id ? proposal : item)),
        selectedProposalId: proposal.id,
        draftTitle: proposal.title,
        draftContent: proposal.currentVersion?.content ?? "",
        saving: false,
        error: null
      }));
    } catch {
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: "Proposal could not be approved"
      }));
    }
  }

  async function sendSelectedProposal(): Promise<void> {
    if (!proposalState.selectedProposalId) {
      return;
    }

    setProposalState((current) => ({ ...current, saving: true, error: null }));

    try {
      const result = await sendApprovedProposal(accessToken, proposalState.selectedProposalId);
      setProposalState((current) => ({
        ...current,
        proposals: current.proposals.map((item) =>
          item.id === result.proposal.id ? result.proposal : item
        ),
        selectedProposalId: result.proposal.id,
        draftTitle: result.proposal.title,
        draftContent: result.proposal.currentVersion?.content ?? "",
        saving: false,
        error: null,
        sendResult: result
      }));
      if (state.selectedLead) {
        const activities = await listLeadActivities(accessToken, state.selectedLead.id).catch(
          () => state.activities
        );
        setState((current) => ({ ...current, activities }));
      }
    } catch {
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: "Approved proposal could not be sent"
      }));
    }
  }

  return (
    <section className="crm-workspace" aria-label="CRM workspace">
      <div className="workspace-rail">
        <div className="workspace-switch" aria-label="Workspace view">
          <button
            className={view === "leads" ? "active" : ""}
            onClick={() => setView("leads")}
            type="button"
          >
            Leads
          </button>
          <button
            className={view === "pipeline" ? "active" : ""}
            onClick={() => setView("pipeline")}
            type="button"
          >
            Pipeline
          </button>
        </div>
        <LeadFilters
          filters={filters}
          stages={state.stages}
          users={state.users}
          onChange={applyFilters}
        />
      </div>

      <div className="workspace-grid">
        <div className="workspace-panel">
          {state.loading ? (
            <StateBlock title="Loading CRM" detail="Fetching real sales records from the API." />
          ) : state.error ? (
            <StateBlock
              title="CRM unavailable"
              detail={state.error}
              action={
                <button onClick={() => void loadWorkspace(filters)} type="button">
                  Retry
                </button>
              }
            />
          ) : leads.length === 0 ? (
            <StateBlock
              title="No leads found"
              detail="Create leads through the API or lead intake flow."
            />
          ) : view === "leads" ? (
            <LeadList leads={leads} selectedLeadId={state.selectedLead?.id} onSelect={selectLead} />
          ) : (
            <PipelineBoard groupedLeads={groupedLeads} onSelect={selectLead} />
          )}
        </div>

        <LeadDetail
          activeTab={activeTab}
          activities={state.activities}
          lead={state.selectedLead}
          stages={state.stages}
          users={state.users}
          conversationState={conversationState}
          currentUser={currentUser}
          onAssignOwner={persistOwner}
          onChangeStage={persistStage}
          onConversationChange={selectConversation}
          onConversationInputChange={(input) =>
            setConversationState((current) => ({ ...current, input }))
          }
          onModeChange={persistConversationMode}
          onProposalApprove={approveSelectedProposal}
          onProposalDraftChange={(patch) =>
            setProposalState((current) => ({ ...current, ...patch, error: null }))
          }
          onProposalRefresh={() =>
            state.selectedLead ? loadLeadProposals(state.selectedLead.id) : Promise.resolve()
          }
          onProposalSave={saveProposalDraft}
          onProposalSelect={selectProposal}
          onProposalSend={sendSelectedProposal}
          onSendProspectMessage={sendProspectMessage}
          onStartConversation={startSimulatorConversation}
          onTabChange={setActiveTab}
          proposalState={proposalState}
        />
      </div>
    </section>
  );
}

function LeadFilters({
  filters,
  stages,
  users,
  onChange
}: {
  filters: LeadListParams;
  stages: PipelineStageDto[];
  users: PublicUser[];
  onChange: (filters: LeadListParams) => Promise<void>;
}): React.JSX.Element {
  return (
    <form className="lead-filters" onSubmit={(event) => event.preventDefault()}>
      <input
        aria-label="Search leads"
        onChange={(event) => void onChange({ search: event.target.value })}
        placeholder="Search leads"
        type="search"
        value={filters.search ?? ""}
      />
      <select
        aria-label="Filter by stage"
        onChange={(event) => void onChange({ stageId: event.target.value })}
        value={filters.stageId ?? ""}
      >
        <option value="">All stages</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by owner"
        onChange={(event) => void onChange({ ownerId: event.target.value })}
        value={filters.ownerId ?? ""}
      >
        <option value="">All owners</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.firstName} {user.lastName}
          </option>
        ))}
      </select>
      <select
        aria-label="Sort leads"
        onChange={(event) =>
          void onChange({ sort: event.target.value as LeadListParams["sort"], direction: "desc" })
        }
        value={filters.sort ?? "lastActivityAt"}
      >
        <option value="lastActivityAt">Latest activity</option>
        <option value="createdAt">Created date</option>
      </select>
    </form>
  );
}

function LeadList({
  leads,
  selectedLeadId,
  onSelect
}: {
  leads: LeadDto[];
  selectedLeadId?: string;
  onSelect: (leadId: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="lead-list" role="table" aria-label="Leads list">
      <div className="lead-row lead-row-head" role="row">
        <span>Company / Contact</span>
        <span>Source</span>
        <span>Score</span>
        <span>Stage</span>
        <span>Owner</span>
        <span>Next Action</span>
      </div>
      {leads.map((lead) => (
        <button
          className={`lead-row ${lead.id === selectedLeadId ? "selected" : ""}`}
          key={lead.id}
          onClick={() => void onSelect(lead.id)}
          role="row"
          type="button"
        >
          <span>
            <strong>{lead.company.name}</strong>
            <small>
              {lead.contact.firstName} {lead.contact.lastName}
            </small>
          </span>
          <span>{lead.source}</span>
          <span>
            {lead.score}
            <StatusBadge tone={temperatureTone(lead.temperature)}>{lead.temperature}</StatusBadge>
          </span>
          <span>{lead.stage.label}</span>
          <span>
            {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
          </span>
          <span>{lead.nextAction ?? "No next action"}</span>
        </button>
      ))}
    </div>
  );
}

function PipelineBoard({
  groupedLeads,
  onSelect
}: {
  groupedLeads: { stage: PipelineStageDto; leads: LeadDto[] }[];
  onSelect: (leadId: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="pipeline-board" aria-label="Pipeline board">
      {groupedLeads.map(({ stage, leads }) => (
        <section className="pipeline-column" key={stage.id}>
          <header>
            <strong>{stage.label}</strong>
            <span>{stage.probability}%</span>
          </header>
          <div className="pipeline-stack">
            {leads.map((lead) => (
              <button
                className="pipeline-card"
                key={lead.id}
                onClick={() => void onSelect(lead.id)}
                type="button"
              >
                <strong>{lead.company.name}</strong>
                <span>{formatMoney(lead.estimatedValue, lead.currency)}</span>
                <small>
                  {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
                </small>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LeadDetail({
  activeTab,
  activities,
  conversationState,
  currentUser,
  lead,
  proposalState,
  stages,
  users,
  onAssignOwner,
  onChangeStage,
  onConversationChange,
  onConversationInputChange,
  onModeChange,
  onProposalApprove,
  onProposalDraftChange,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onSendProspectMessage,
  onStartConversation,
  onTabChange
}: {
  activeTab: DetailTab;
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto | null;
  proposalState: ProposalState;
  stages: PipelineStageDto[];
  users: PublicUser[];
  onAssignOwner: (ownerId: string) => Promise<void>;
  onChangeStage: (stageId: string) => Promise<void>;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onProposalApprove: () => Promise<void>;
  onProposalDraftChange: (
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent">>
  ) => void;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onTabChange: (tab: DetailTab) => void;
}): React.JSX.Element {
  if (!lead) {
    return (
      <aside className="lead-detail">
        <StateBlock
          title="Select a lead"
          detail="Lead detail opens here when real CRM records exist."
        />
      </aside>
    );
  }

  return (
    <aside className="lead-detail" aria-label="Lead detail">
      <header className="detail-hero">
        <div>
          <p className="eyebrow">{lead.source}</p>
          <h2>{lead.company.name}</h2>
          <p>
            {lead.contact.firstName} {lead.contact.lastName}
            {lead.contact.title ? `, ${lead.contact.title}` : ""}
          </p>
        </div>
        <div className="score-orbit" aria-label={`Lead score ${String(lead.score)}`}>
          <span>{lead.score}</span>
          <StatusBadge tone={temperatureTone(lead.temperature)}>{lead.temperature}</StatusBadge>
        </div>
      </header>

      <div className="detail-controls">
        <label>
          Stage
          <select
            aria-label="Change lead stage"
            onChange={(event) => void onChangeStage(event.target.value)}
            value={lead.stageId}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select
            aria-label="Assign owner"
            onChange={(event) => void onAssignOwner(event.target.value)}
            value={lead.ownerId ?? ""}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.firstName} {user.lastName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="detail-metrics">
        <span>{formatMoney(lead.estimatedValue, lead.currency)}</span>
        <span>{formatDate(lead.lastActivityAt)}</span>
        <span>{lead.nextAction ?? "No next action"}</span>
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Lead sections">
        {detailTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "active" : ""}
            key={tab}
            onClick={() => onTabChange(tab)}
            role="tab"
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      <DetailTabPanel
        activities={activities}
        conversationState={conversationState}
        currentUser={currentUser}
        lead={lead}
        proposalState={proposalState}
        tab={activeTab}
        onConversationChange={onConversationChange}
        onConversationInputChange={onConversationInputChange}
        onModeChange={onModeChange}
        onProposalApprove={onProposalApprove}
        onProposalDraftChange={onProposalDraftChange}
        onProposalRefresh={onProposalRefresh}
        onProposalSave={onProposalSave}
        onProposalSelect={onProposalSelect}
        onProposalSend={onProposalSend}
        onSendProspectMessage={onSendProspectMessage}
        onStartConversation={onStartConversation}
      />
    </aside>
  );
}

function DetailTabPanel({
  activities,
  conversationState,
  currentUser,
  lead,
  proposalState,
  tab,
  onConversationChange,
  onConversationInputChange,
  onModeChange,
  onProposalApprove,
  onProposalDraftChange,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onSendProspectMessage,
  onStartConversation
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto;
  proposalState: ProposalState;
  tab: DetailTab;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onProposalApprove: () => Promise<void>;
  onProposalDraftChange: (
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent">>
  ) => void;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
}): React.JSX.Element {
  if (tab === "Conversation") {
    return (
      <ConversationSimulator
        activities={activities}
        conversationState={conversationState}
        lead={lead}
        onConversationChange={onConversationChange}
        onConversationInputChange={onConversationInputChange}
        onModeChange={onModeChange}
        onSendProspectMessage={onSendProspectMessage}
        onStartConversation={onStartConversation}
      />
    );
  }

  if (tab === "Proposals") {
    return (
      <ProposalReviewPanel
        currentUser={currentUser}
        proposalState={proposalState}
        onApprove={onProposalApprove}
        onDraftChange={onProposalDraftChange}
        onRefresh={onProposalRefresh}
        onSave={onProposalSave}
        onSelect={onProposalSelect}
        onSend={onProposalSend}
      />
    );
  }

  if (tab === "Activities") {
    return (
      <div className="tab-panel">
        {activities.length === 0 ? (
          <StateBlock title="No activities yet" />
        ) : (
          activities.map((activity) => (
            <article className="activity-item" key={activity.id}>
              <strong>{activity.type.replaceAll("_", " ")}</strong>
              <span>{activity.description}</span>
              <small>{formatDate(activity.createdAt)}</small>
            </article>
          ))
        )}
      </div>
    );
  }

  if (tab === "Deal") {
    return (
      <div className="tab-panel">
        <p>{formatMoney(lead.estimatedValue, lead.currency)}</p>
        <p>
          {lead.stage.label} pipeline probability is {lead.stage.probability}%.
        </p>
      </div>
    );
  }

  if (tab === "Overview") {
    return (
      <div className="tab-panel">
        <p>{lead.requirement ?? "Requirement not captured yet."}</p>
        <p>{lead.serviceInterest ?? "Service interest not captured yet."}</p>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <StateBlock
        title={`${tab} comes in a later milestone`}
        detail="This tab is reserved without fake runtime data."
      />
    </div>
  );
}

function ProposalReviewPanel({
  currentUser,
  proposalState,
  onApprove,
  onDraftChange,
  onRefresh,
  onSave,
  onSelect,
  onSend
}: {
  currentUser: PublicUser;
  proposalState: ProposalState;
  onApprove: () => Promise<void>;
  onDraftChange: (patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent">>) => void;
  onRefresh: () => Promise<void>;
  onSave: () => Promise<void>;
  onSelect: (proposalId: string) => void;
  onSend: () => Promise<void>;
}): React.JSX.Element {
  const selectedProposal =
    proposalState.proposals.find((proposal) => proposal.id === proposalState.selectedProposalId) ??
    null;
  const canApprove = currentUser.role === "ADMIN" || currentUser.role === "SALES_MANAGER";
  const canEdit =
    selectedProposal?.status === "DRAFT" || selectedProposal?.status === "WAITING_APPROVAL";
  const canSend = canApprove && selectedProposal?.status === "APPROVED";
  const latestVersion = selectedProposal?.currentVersion;

  if (proposalState.loading) {
    return (
      <div className="tab-panel proposal-review">
        <StateBlock title="Loading proposals" detail="Fetching real proposal records." />
      </div>
    );
  }

  if (proposalState.proposals.length === 0) {
    return (
      <div className="tab-panel proposal-review">
        <StateBlock
          title="No proposals"
          detail="Proposal generation or manual creation must create records before review."
          action={
            <button onClick={() => void onRefresh()} type="button">
              Refresh
            </button>
          }
        />
        {proposalState.error ? <p className="form-error">{proposalState.error}</p> : null}
      </div>
    );
  }

  return (
    <div className="tab-panel proposal-review">
      <div className="proposal-list" aria-label="Proposal list">
        {proposalState.proposals.map((proposal) => (
          <button
            className={`proposal-list-item ${
              proposal.id === selectedProposal?.id ? "selected" : ""
            }`}
            key={proposal.id}
            onClick={() => onSelect(proposal.id)}
            type="button"
          >
            <strong>{proposal.title}</strong>
            <span>{proposal.status.replaceAll("_", " ")}</span>
            <small>v{proposal.currentVersion?.version ?? 0}</small>
          </button>
        ))}
      </div>

      {selectedProposal ? (
        <section className="proposal-editor" aria-label="Proposal review">
          <header className="proposal-editor-head">
            <div>
              <p className="eyebrow">Proposal Review</p>
              <h3>{selectedProposal.title}</h3>
            </div>
            <StatusBadge
              tone={
                selectedProposal.status === "SENT"
                  ? "hot"
                  : selectedProposal.status === "APPROVED"
                    ? "warm"
                    : "neutral"
              }
            >
              {selectedProposal.status.replaceAll("_", " ")}
            </StatusBadge>
          </header>

          <div className="proposal-meta">
            <span>Created {formatDate(selectedProposal.createdAt)}</span>
            <span>
              Approved{" "}
              {selectedProposal.approvedAt ? formatDate(selectedProposal.approvedAt) : "not yet"}
            </span>
            <span>Zoho {selectedProposal.zohoTimelineSyncStatus.replaceAll("_", " ")}</span>
          </div>

          <label className="proposal-field">
            Title
            <input
              disabled={!canEdit || proposalState.saving}
              onChange={(event) => onDraftChange({ draftTitle: event.target.value })}
              value={proposalState.draftTitle}
            />
          </label>

          <label className="proposal-field">
            Proposal content
            <textarea
              disabled={!canEdit || proposalState.saving}
              onChange={(event) => onDraftChange({ draftContent: event.target.value })}
              rows={12}
              value={proposalState.draftContent}
            />
          </label>

          <div className="proposal-actions">
            <button
              disabled={
                !canEdit ||
                proposalState.saving ||
                proposalState.draftTitle.trim().length === 0 ||
                proposalState.draftContent.trim().length === 0
              }
              onClick={() => void onSave()}
              type="button"
            >
              Save draft
            </button>
            <button
              disabled={
                !canApprove ||
                proposalState.saving ||
                selectedProposal.status !== "WAITING_APPROVAL" ||
                !latestVersion
              }
              onClick={() => void onApprove()}
              type="button"
            >
              Approve
            </button>
            <button
              disabled={!canSend || proposalState.saving || !selectedProposal.approvedVersion}
              onClick={() => void onSend()}
              type="button"
            >
              Send approved
            </button>
            <button disabled={proposalState.saving} onClick={() => void onRefresh()} type="button">
              Refresh
            </button>
          </div>

          {selectedProposal.zohoTimelineLastError ? (
            <p className="form-error">Zoho timeline: {selectedProposal.zohoTimelineLastError}</p>
          ) : null}
          {proposalState.error ? <p className="form-error">{proposalState.error}</p> : null}
          {proposalState.sendResult ? (
            <div className="proposal-send-result" role="status">
              <span>
                Email {proposalState.sendResult.outboundEmail.status.replaceAll("_", " ")}
              </span>
              <span>
                Zoho{" "}
                {proposalState.sendResult.zohoTimeline
                  ? proposalState.sendResult.zohoTimeline.status.replaceAll("_", " ")
                  : selectedProposal.zohoTimelineSyncStatus.replaceAll("_", " ")}
              </span>
            </div>
          ) : null}
        </section>
      ) : (
        <StateBlock title="Select a proposal" />
      )}
    </div>
  );
}

function ConversationSimulator({
  activities,
  conversationState,
  lead,
  onConversationChange,
  onConversationInputChange,
  onModeChange,
  onSendProspectMessage,
  onStartConversation
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  lead: LeadDto;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
}): React.JSX.Element {
  const selectedConversation = conversationState.selectedConversation;
  const messageActivities = activities
    .filter((activity) => activity.type === "MESSAGE_RECEIVED" || activity.type === "MESSAGE_SENT")
    .slice(0, 4);

  if (conversationState.loading) {
    return (
      <div className="tab-panel simulator-panel">
        <StateBlock title="Loading conversation" />
      </div>
    );
  }

  if (!selectedConversation) {
    return (
      <div className="tab-panel simulator-panel">
        <div className="simulator-empty">
          <StateBlock
            title="No conversation yet"
            action={
              <button
                disabled={conversationState.saving}
                onClick={() => void onStartConversation()}
                type="button"
              >
                Start simulator
              </button>
            }
          />
          {conversationState.error ? <p className="form-error">{conversationState.error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tab-panel simulator-panel">
      <div className="simulator-toolbar">
        <select
          aria-label="Select conversation"
          onChange={(event) => void onConversationChange(event.target.value)}
          value={selectedConversation.id}
        >
          {conversationState.conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.channel} - {formatDate(conversation.lastMessageAt)}
            </option>
          ))}
        </select>
        <select
          aria-label="AI mode"
          onChange={(event) => void onModeChange(event.target.value as ConversationModeName)}
          value={selectedConversation.mode}
        >
          {CONVERSATION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {conversationState.error ? <p className="form-error">{conversationState.error}</p> : null}

      <div className="simulator-grid">
        <section className="conversation-thread" aria-label="Conversation thread">
          {conversationState.messages.length === 0 ? (
            <StateBlock title="No messages yet" />
          ) : (
            conversationState.messages.map((message) => (
              <article
                className={`message-bubble ${message.direction.toLowerCase()}`}
                key={message.id}
              >
                <span>{message.senderType.replaceAll("_", " ")}</span>
                <p>{message.body}</p>
                <small>{formatDate(message.createdAt)}</small>
              </article>
            ))
          )}
        </section>

        <aside className="simulator-side" aria-label="Lead qualification and score">
          <section>
            <strong>Qualification</strong>
            <span>{lead.requirement ?? "Unknown requirement"}</span>
            <span>{lead.serviceInterest ?? "Unknown service interest"}</span>
          </section>
          <section>
            <strong>Score</strong>
            <span>{lead.score}</span>
            <StatusBadge tone={temperatureTone(lead.temperature)}>{lead.temperature}</StatusBadge>
          </section>
          <section>
            <strong>Activity</strong>
            {messageActivities.length === 0 ? (
              <span>No message activity</span>
            ) : (
              messageActivities.map((activity) => (
                <span key={activity.id}>{activity.type.replaceAll("_", " ")}</span>
              ))
            )}
          </section>
        </aside>
      </div>

      <form
        className="simulator-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void onSendProspectMessage();
        }}
      >
        <textarea
          aria-label="Prospect message"
          onChange={(event) => onConversationInputChange(event.target.value)}
          placeholder="Prospect message"
          rows={3}
          value={conversationState.input}
        />
        <button
          disabled={conversationState.saving || conversationState.input.trim().length === 0}
          type="submit"
        >
          Save inbound
        </button>
      </form>
    </div>
  );
}
