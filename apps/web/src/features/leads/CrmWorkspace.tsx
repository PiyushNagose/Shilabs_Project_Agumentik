import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CONVERSATION_MODES,
  type ActivityDto,
  type AgentCorrectionDto,
  type BriefingRunDto,
  type ConversationDto,
  type ConversationModeName,
  type HumanTakeoverBriefingDto,
  type InternalNotificationDto,
  type LeadDto,
  type LeadTemperatureName,
  type MeetingRequestDto,
  type MessageDto,
  type PaginatedResponse,
  type PipelineStageDto,
  type ProposalDto,
  type ProposalSendResultDto,
  type PublicUser
} from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import {
  assignLead,
  appendConversationMessage,
  acknowledgeNotification,
  approveProposal,
  confirmMeetingRequest,
  createProposalAgentCorrection,
  createConversation,
  createMeetingRequest,
  generateLeadBriefing,
  generateMeetingBriefing,
  getLead,
  getHumanTakeoverBriefing,
  listBriefings,
  listConversationMessages,
  listConversations,
  listLeadActivities,
  listLeads,
  listMeetingRequests,
  listNotifications,
  listPipelineStages,
  listProposals,
  listAgentCorrections,
  listUsers,
  markNotificationRead,
  sendApprovedProposal,
  startHumanTakeover,
  updateConversationMode,
  updateLeadStage,
  updateProposalDraft,
  type LeadListParams
} from "../../services/api-client.js";

type WorkspaceView = "leads" | "pipeline";
export type DetailTab =
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
  initialLeadId?: string | null;
  initialTab?: DetailTab;
}

interface WorkspaceState {
  leadsPage: PaginatedResponse<LeadDto> | null;
  stages: PipelineStageDto[];
  users: PublicUser[];
  selectedLead: LeadDto | null;
  activities: ActivityDto[];
  notifications: InternalNotificationDto[];
  loading: boolean;
  error: string | null;
}

interface ConversationState {
  conversations: ConversationDto[];
  selectedConversation: ConversationDto | null;
  messages: MessageDto[];
  takeoverBriefing: HumanTakeoverBriefingDto | null;
  input: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface ProposalState {
  proposals: ProposalDto[];
  selectedProposalId: string | null;
  corrections: AgentCorrectionDto[];
  correctionSummary: string;
  draftTitle: string;
  draftContent: string;
  loading: boolean;
  saving: boolean;
  correctionSaving: boolean;
  error: string | null;
  sendResult: ProposalSendResultDto | null;
}

interface MeetingState {
  requests: MeetingRequestDto[];
  title: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface BriefingState {
  leadBriefings: BriefingRunDto[];
  meetingBriefings: BriefingRunDto[];
  loading: boolean;
  saving: boolean;
  error: string | null;
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
  takeoverBriefing: null,
  input: "",
  loading: false,
  saving: false,
  error: null
};

const initialProposalState: ProposalState = {
  proposals: [],
  selectedProposalId: null,
  corrections: [],
  correctionSummary: "",
  draftTitle: "",
  draftContent: "",
  loading: false,
  saving: false,
  correctionSaving: false,
  error: null,
  sendResult: null
};

const initialMeetingState: MeetingState = {
  requests: [],
  title: "",
  windowStart: "",
  windowEnd: "",
  durationMinutes: 30,
  loading: false,
  saving: false,
  error: null
};

const initialBriefingState: BriefingState = {
  leadBriefings: [],
  meetingBriefings: [],
  loading: false,
  saving: false,
  error: null
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

export function CrmWorkspace({
  accessToken,
  currentUser,
  initialLeadId = null,
  initialTab
}: CrmWorkspaceProps): React.JSX.Element {
  const [view, setView] = useState<WorkspaceView>("leads");
  const [activeTab, setActiveTab] = useState<DetailTab>("Overview");
  const [filters, setFilters] = useState<LeadListParams>(initialFilters);
  const [state, setState] = useState<WorkspaceState>({
    leadsPage: null,
    stages: [],
    users: [],
    selectedLead: null,
    activities: [],
    notifications: [],
    loading: true,
    error: null
  });
  const [conversationState, setConversationState] =
    useState<ConversationState>(initialConversationState);
  const [proposalState, setProposalState] = useState<ProposalState>(initialProposalState);
  const [meetingState, setMeetingState] = useState<MeetingState>(initialMeetingState);
  const [briefingState, setBriefingState] = useState<BriefingState>(initialBriefingState);

  async function loadWorkspace(
    nextFilters = filters,
    leadId: string | null | undefined = state.selectedLead?.id
  ): Promise<void> {
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const [leadsPage, stages, users] = await Promise.all([
        listLeads(accessToken, nextFilters),
        listPipelineStages(accessToken),
        listUsers(accessToken).catch(() => [currentUser])
      ]);
      const selectedLead = leadId
        ? await getLead(accessToken, leadId).catch(() => leadsPage.items[0] ?? null)
        : (leadsPage.items[0] ?? null);
      const activities = selectedLead
        ? await listLeadActivities(accessToken, selectedLead.id).catch(() => [])
        : [];
      const notifications = selectedLead
        ? await listNotifications(accessToken, { leadId: selectedLead.id, limit: 10 }).catch(
            () => []
          )
        : [];

      setState({
        leadsPage,
        stages,
        users,
        selectedLead,
        activities,
        notifications,
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
    void loadWorkspace(initialFilters, initialLeadId);
  }, [accessToken]);

  useEffect(() => {
    if (initialLeadId) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      void selectLead(initialLeadId);
    }
  }, [initialLeadId, initialTab]);

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

  useEffect(() => {
    if (activeTab === "Meetings" && state.selectedLead) {
      void loadLeadMeetings(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  useEffect(() => {
    if (activeTab === "AI Insights" && state.selectedLead) {
      void loadLeadBriefings(state.selectedLead.id);
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
      const takeoverBriefing =
        selectedConversation?.mode === "HUMAN"
          ? await getHumanTakeoverBriefing(accessToken, selectedConversation.id).catch(() => null)
          : null;

      setConversationState((current) => ({
        ...current,
        conversations,
        selectedConversation,
        messages,
        takeoverBriefing,
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
      const corrections = selectedProposal
        ? await listAgentCorrections(accessToken, { proposalId: selectedProposal.id, limit: 10 })
        : [];

      setProposalState((current) => ({
        ...current,
        proposals,
        selectedProposalId: selectedProposal?.id ?? null,
        corrections,
        correctionSummary: "",
        draftTitle: selectedProposal?.title ?? "",
        draftContent: selectedProposal?.currentVersion?.content ?? "",
        loading: false,
        saving: false,
        correctionSaving: false,
        error: null,
        sendResult: null
      }));
    } catch {
      setProposalState((current) => ({
        ...current,
        loading: false,
        saving: false,
        correctionSaving: false,
        error: "Proposals could not be loaded"
      }));
    }
  }

  async function loadProposalCorrections(proposalId: string): Promise<AgentCorrectionDto[]> {
    return listAgentCorrections(accessToken, { proposalId, limit: 10 });
  }

  async function loadLeadMeetings(leadId: string): Promise<void> {
    setMeetingState((current) => ({ ...current, loading: true, error: null }));

    try {
      const requests = await listMeetingRequests(accessToken, { leadId, limit: 50 });
      setMeetingState((current) => ({
        ...current,
        requests,
        loading: false,
        saving: false,
        error: null
      }));
    } catch {
      setMeetingState((current) => ({
        ...current,
        loading: false,
        saving: false,
        error: "Meeting requests could not be loaded"
      }));
    }
  }

  async function loadLeadBriefings(leadId: string): Promise<void> {
    setBriefingState((current) => ({ ...current, loading: true, error: null }));

    try {
      const [leadBriefings, meetingBriefings] = await Promise.all([
        listBriefings(accessToken, { leadId, kind: "LEAD", limit: 10 }),
        listBriefings(accessToken, { leadId, kind: "MEETING", limit: 20 })
      ]);
      setBriefingState((current) => ({
        ...current,
        leadBriefings,
        meetingBriefings,
        loading: false,
        saving: false,
        error: null
      }));
    } catch {
      setBriefingState((current) => ({
        ...current,
        loading: false,
        saving: false,
        error: "Briefings could not be loaded"
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
    await loadWorkspace(merged, null);
  }

  async function selectLead(leadId: string): Promise<void> {
    const lead = await getLead(accessToken, leadId);
    const activities = await listLeadActivities(accessToken, leadId).catch(() => []);
    const notifications = await listNotifications(accessToken, { leadId, limit: 10 }).catch(
      () => []
    );
    setState((current) => ({ ...current, selectedLead: lead, activities, notifications }));
    setConversationState(initialConversationState);
    setProposalState(initialProposalState);
    setMeetingState(initialMeetingState);
    setBriefingState(initialBriefingState);
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
      const takeoverBriefing =
        selectedConversation.mode === "HUMAN"
          ? await getHumanTakeoverBriefing(accessToken, selectedConversation.id).catch(() => null)
          : null;
      setConversationState((current) => ({
        ...current,
        messages,
        takeoverBriefing,
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
      ),
      takeoverBriefing: conversation.mode === "HUMAN" ? current.takeoverBriefing : null
    }));
  }

  async function startSelectedHumanTakeover(): Promise<void> {
    if (!conversationState.selectedConversation) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));
    try {
      await startHumanTakeover(accessToken, conversationState.selectedConversation.id, {
        reason: "Manual takeover from Sales Workspace"
      });
      const briefing = await getHumanTakeoverBriefing(
        accessToken,
        conversationState.selectedConversation.id
      );
      const conversation = { ...conversationState.selectedConversation, mode: "HUMAN" as const };
      const activities = state.selectedLead
        ? await listLeadActivities(accessToken, state.selectedLead.id).catch(() => state.activities)
        : state.activities;
      const notifications = state.selectedLead
        ? await listNotifications(accessToken, { leadId: state.selectedLead.id, limit: 10 }).catch(
            () => state.notifications
          )
        : state.notifications;
      setState((current) => ({ ...current, activities, notifications }));
      setConversationState((current) => ({
        ...current,
        selectedConversation: conversation,
        conversations: current.conversations.map((item) =>
          item.id === conversation.id ? conversation : item
        ),
        takeoverBriefing: briefing,
        saving: false,
        error: null
      }));
    } catch {
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: "Human takeover could not be started"
      }));
    }
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
      corrections: [],
      correctionSummary: "",
      draftTitle: proposal.title,
      draftContent: proposal.currentVersion?.content ?? "",
      sendResult: null,
      error: null
    }));
    void loadProposalCorrections(proposal.id)
      .then((corrections) => {
        setProposalState((current) =>
          current.selectedProposalId === proposal.id ? { ...current, corrections } : current
        );
      })
      .catch(() => {
        setProposalState((current) =>
          current.selectedProposalId === proposal.id
            ? { ...current, error: "Correction history could not be loaded" }
            : current
        );
      });
  }

  async function recordProposalCorrection(): Promise<void> {
    if (!proposalState.selectedProposalId) return;
    const summary = proposalState.correctionSummary.trim();
    if (!summary) {
      setProposalState((current) => ({ ...current, error: "Correction summary is required" }));
      return;
    }
    const selectedProposal = proposalState.proposals.find(
      (proposal) => proposal.id === proposalState.selectedProposalId
    );
    if (!selectedProposal) return;

    setProposalState((current) => ({ ...current, correctionSaving: true, error: null }));
    try {
      const correction = await createProposalAgentCorrection(accessToken, selectedProposal.id, {
        correctionSummary: summary,
        correctedOutcome: {
          title: proposalState.draftTitle,
          content: proposalState.draftContent,
          note: summary,
          source: "proposal-review-ui"
        },
        supersedesCorrectionId: proposalState.corrections[0]?.id
      });
      setProposalState((current) => ({
        ...current,
        corrections: [correction, ...current.corrections.filter((item) => item.id !== correction.id)],
        correctionSummary: "",
        correctionSaving: false,
        error: null
      }));
    } catch {
      setProposalState((current) => ({
        ...current,
        correctionSaving: false,
        error: "Correction could not be recorded"
      }));
    }
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

  function updateMeetingDraft(patch: Partial<MeetingState>): void {
    setMeetingState((current) => ({ ...current, ...patch }));
  }

  async function requestMeetingSlots(): Promise<void> {
    if (!state.selectedLead) return;
    setMeetingState((current) => ({ ...current, saving: true, error: null }));

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
      const request = await createMeetingRequest(accessToken, {
        leadId: state.selectedLead.id,
        ownerId: state.selectedLead.ownerId ?? currentUser.id,
        title:
          meetingState.title.trim() ||
          `Meeting with ${state.selectedLead.contact.firstName} ${state.selectedLead.contact.lastName}`,
        timeZone,
        windowStart: new Date(meetingState.windowStart).toISOString(),
        windowEnd: new Date(meetingState.windowEnd).toISOString(),
        durationMinutes: meetingState.durationMinutes,
        slotMinutes: meetingState.durationMinutes
      });
      setMeetingState((current) => ({
        ...current,
        requests: [request, ...current.requests.filter((item) => item.id !== request.id)],
        saving: false,
        error: null
      }));
      const [activities, notifications] = await Promise.all([
        listLeadActivities(accessToken, state.selectedLead.id).catch(() => state.activities),
        listNotifications(accessToken, { leadId: state.selectedLead.id, limit: 10 }).catch(
          () => state.notifications
        )
      ]);
      setState((current) => ({ ...current, activities, notifications }));
    } catch {
      setMeetingState((current) => ({
        ...current,
        saving: false,
        error: "Meeting slots could not be requested"
      }));
    }
  }

  async function confirmMeetingSlot(meetingRequestId: string, slotId: string): Promise<void> {
    setMeetingState((current) => ({ ...current, saving: true, error: null }));
    try {
      const request = await confirmMeetingRequest(accessToken, meetingRequestId, { slotId });
      setMeetingState((current) => ({
        ...current,
        requests: current.requests.map((item) => (item.id === request.id ? request : item)),
        saving: false,
        error: null
      }));
      if (state.selectedLead) {
        const activities = await listLeadActivities(accessToken, state.selectedLead.id).catch(
          () => state.activities
        );
        setState((current) => ({ ...current, activities }));
      }
    } catch {
      setMeetingState((current) => ({
        ...current,
        saving: false,
        error: "Meeting could not be confirmed"
      }));
    }
  }

  async function generateSelectedLeadBriefing(): Promise<void> {
    if (!state.selectedLead) return;
    setBriefingState((current) => ({ ...current, saving: true, error: null }));
    try {
      const run = await generateLeadBriefing(accessToken, state.selectedLead.id);
      const [activities, leadBriefings] = await Promise.all([
        listLeadActivities(accessToken, state.selectedLead.id).catch(() => state.activities),
        listBriefings(accessToken, { leadId: state.selectedLead.id, kind: "LEAD", limit: 10 })
      ]);
      setState((current) => ({ ...current, activities }));
      setBriefingState((current) => ({
        ...current,
        leadBriefings: [run, ...leadBriefings.filter((item) => item.id !== run.id)],
        saving: false,
        error: run.status === "FAILED" ? (run.failureMessage ?? "Briefing generation failed") : null
      }));
    } catch {
      setBriefingState((current) => ({
        ...current,
        saving: false,
        error: "Lead briefing could not be generated"
      }));
    }
  }

  async function generateMeetingRequestBriefing(meetingRequestId: string): Promise<void> {
    if (!state.selectedLead) return;
    setBriefingState((current) => ({ ...current, saving: true, error: null }));
    try {
      const run = await generateMeetingBriefing(accessToken, meetingRequestId);
      const meetingBriefings = await listBriefings(accessToken, {
        leadId: state.selectedLead.id,
        kind: "MEETING",
        limit: 20
      });
      setBriefingState((current) => ({
        ...current,
        meetingBriefings: [run, ...meetingBriefings.filter((item) => item.id !== run.id)],
        saving: false,
        error: run.status === "FAILED" ? (run.failureMessage ?? "Briefing generation failed") : null
      }));
    } catch {
      setBriefingState((current) => ({
        ...current,
        saving: false,
        error: "Meeting briefing could not be generated"
      }));
    }
  }

  async function markLeadNotificationRead(notificationId: string): Promise<void> {
    const notification = await markNotificationRead(accessToken, notificationId);
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((item) =>
        item.id === notification.id ? notification : item
      )
    }));
  }

  async function acknowledgeLeadNotification(notificationId: string): Promise<void> {
    const notification = await acknowledgeNotification(accessToken, notificationId);
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((item) =>
        item.id === notification.id ? notification : item
      )
    }));
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
            <Icon name="layout-list" size={16} />
            Leads
          </button>
          <button
            className={view === "pipeline" ? "active" : ""}
            onClick={() => setView("pipeline")}
            type="button"
          >
            <Icon name="bar-chart" size={16} />
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
                  <Icon name="refresh" size={16} />
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
          notifications={state.notifications}
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
          meetingState={meetingState}
          briefingState={briefingState}
          onGenerateLeadBriefing={generateSelectedLeadBriefing}
          onGenerateMeetingBriefing={generateMeetingRequestBriefing}
          onAcknowledgeNotification={acknowledgeLeadNotification}
          onReadNotification={markLeadNotificationRead}
          onMeetingConfirm={confirmMeetingSlot}
          onMeetingDraftChange={updateMeetingDraft}
          onMeetingRefresh={loadLeadMeetings}
          onMeetingRequest={requestMeetingSlots}
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
          onProposalCorrection={recordProposalCorrection}
          onSendProspectMessage={sendProspectMessage}
          onStartConversation={startSimulatorConversation}
          onStartHumanTakeover={startSelectedHumanTakeover}
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
      <div className="filter-search">
        <Icon name="filter" size={16} />
        <input
          aria-label="Search leads"
          onChange={(event) => void onChange({ search: event.target.value })}
          placeholder="Search leads"
          type="search"
          value={filters.search ?? ""}
        />
      </div>
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
  briefingState,
  meetingState,
  notifications,
  proposalState,
  stages,
  users,
  onAssignOwner,
  onChangeStage,
  onConversationChange,
  onConversationInputChange,
  onGenerateLeadBriefing,
  onGenerateMeetingBriefing,
  onAcknowledgeNotification,
  onReadNotification,
  onMeetingConfirm,
  onMeetingDraftChange,
  onMeetingRefresh,
  onMeetingRequest,
  onModeChange,
  onProposalApprove,
  onProposalDraftChange,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onProposalCorrection,
  onSendProspectMessage,
  onStartConversation,
  onStartHumanTakeover,
  onTabChange
}: {
  activeTab: DetailTab;
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto | null;
  briefingState: BriefingState;
  meetingState: MeetingState;
  notifications: InternalNotificationDto[];
  proposalState: ProposalState;
  stages: PipelineStageDto[];
  users: PublicUser[];
  onAssignOwner: (ownerId: string) => Promise<void>;
  onChangeStage: (stageId: string) => Promise<void>;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onGenerateLeadBriefing: () => Promise<void>;
  onGenerateMeetingBriefing: (meetingRequestId: string) => Promise<void>;
  onAcknowledgeNotification: (notificationId: string) => Promise<void>;
  onReadNotification: (notificationId: string) => Promise<void>;
  onMeetingConfirm: (meetingRequestId: string, slotId: string) => Promise<void>;
  onMeetingDraftChange: (patch: Partial<MeetingState>) => void;
  onMeetingRefresh: (leadId: string) => Promise<void>;
  onMeetingRequest: () => Promise<void>;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onProposalApprove: () => Promise<void>;
  onProposalDraftChange: (
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent" | "correctionSummary">>
  ) => void;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onProposalCorrection: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
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

      <NotificationAlerts
        notifications={notifications}
        onAcknowledge={onAcknowledgeNotification}
        onRead={onReadNotification}
      />

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
        briefingState={briefingState}
        meetingState={meetingState}
        proposalState={proposalState}
        tab={activeTab}
        onConversationChange={onConversationChange}
        onConversationInputChange={onConversationInputChange}
        onModeChange={onModeChange}
        onGenerateLeadBriefing={onGenerateLeadBriefing}
        onGenerateMeetingBriefing={onGenerateMeetingBriefing}
        onMeetingConfirm={onMeetingConfirm}
        onMeetingDraftChange={onMeetingDraftChange}
        onMeetingRefresh={onMeetingRefresh}
        onMeetingRequest={onMeetingRequest}
        onProposalApprove={onProposalApprove}
        onProposalDraftChange={onProposalDraftChange}
        onProposalRefresh={onProposalRefresh}
        onProposalSave={onProposalSave}
        onProposalSelect={onProposalSelect}
        onProposalSend={onProposalSend}
        onProposalCorrection={onProposalCorrection}
        onSendProspectMessage={onSendProspectMessage}
        onStartConversation={onStartConversation}
        onStartHumanTakeover={onStartHumanTakeover}
      />
    </aside>
  );
}

function NotificationAlerts({
  notifications,
  onAcknowledge,
  onRead
}: {
  notifications: InternalNotificationDto[];
  onAcknowledge: (notificationId: string) => Promise<void>;
  onRead: (notificationId: string) => Promise<void>;
}): React.JSX.Element | null {
  const handoffAlerts = notifications.filter(
    (notification) =>
      notification.status === "UNREAD" ||
      notification.status === "ATTENTION_REQUIRED" ||
      notification.status === "ESCALATED"
  );

  if (handoffAlerts.length === 0) {
    return null;
  }

  return (
    <section className="notification-alerts" aria-label="Lead alerts">
      {handoffAlerts.slice(0, 3).map((notification) => (
        <article className="notification-alert" key={notification.id}>
          <div>
            <strong>{notification.title}</strong>
            <span>{notification.body}</span>
          </div>
          <StatusBadge tone={notification.severity === "CRITICAL" ? "hot" : "warm"}>
            {notification.status.replaceAll("_", " ")}
          </StatusBadge>
          <div className="notification-actions">
            <button
              disabled={notification.status !== "UNREAD"}
              onClick={() => void onRead(notification.id)}
              type="button"
            >
              <Icon name="check" size={14} />
              Read
            </button>
            <button onClick={() => void onAcknowledge(notification.id)} type="button">
              <Icon name="check" size={14} />
              Acknowledge
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function DetailTabPanel({
  activities,
  conversationState,
  currentUser,
  lead,
  briefingState,
  meetingState,
  proposalState,
  tab,
  onConversationChange,
  onConversationInputChange,
  onGenerateLeadBriefing,
  onGenerateMeetingBriefing,
  onModeChange,
  onMeetingConfirm,
  onMeetingDraftChange,
  onMeetingRefresh,
  onMeetingRequest,
  onProposalApprove,
  onProposalDraftChange,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onProposalCorrection,
  onSendProspectMessage,
  onStartConversation,
  onStartHumanTakeover
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto;
  briefingState: BriefingState;
  meetingState: MeetingState;
  proposalState: ProposalState;
  tab: DetailTab;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onGenerateLeadBriefing: () => Promise<void>;
  onGenerateMeetingBriefing: (meetingRequestId: string) => Promise<void>;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onMeetingConfirm: (meetingRequestId: string, slotId: string) => Promise<void>;
  onMeetingDraftChange: (patch: Partial<MeetingState>) => void;
  onMeetingRefresh: (leadId: string) => Promise<void>;
  onMeetingRequest: () => Promise<void>;
  onProposalApprove: () => Promise<void>;
  onProposalDraftChange: (
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent" | "correctionSummary">>
  ) => void;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onProposalCorrection: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
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
        onStartHumanTakeover={onStartHumanTakeover}
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
        onCorrection={onProposalCorrection}
      />
    );
  }

  if (tab === "Meetings") {
    return (
      <MeetingPanel
        briefingState={briefingState}
        lead={lead}
        meetingState={meetingState}
        onConfirm={onMeetingConfirm}
        onDraftChange={onMeetingDraftChange}
        onGenerateBriefing={onGenerateMeetingBriefing}
        onRefresh={onMeetingRefresh}
        onRequest={onMeetingRequest}
      />
    );
  }

  if (tab === "AI Insights") {
    return (
      <LeadBriefingPanel
        briefingState={briefingState}
        lead={lead}
        onGenerate={onGenerateLeadBriefing}
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

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function briefingOutput(run: BriefingRunDto): Record<string, unknown> {
  return typeof run.output === "object" && run.output !== null && !Array.isArray(run.output)
    ? (run.output as Record<string, unknown>)
    : {};
}

function BriefingCard({ run }: { run: BriefingRunDto }): React.JSX.Element {
  const output = briefingOutput(run);
  const summary = run.summary ?? textField(output.summary) ?? "No summary returned";
  const recommended =
    run.recommendedNextAction ?? textField(output.recommendedNextAction) ?? "No next action";

  return (
    <article className={`briefing-card ${run.status.toLowerCase()}`}>
      <header>
        <div>
          <strong>{run.kind === "MEETING" ? "Meeting briefing" : "Lead briefing"}</strong>
          <small>{formatDate(run.createdAt)}</small>
        </div>
        <StatusBadge tone={run.status === "COMPLETED" ? "warm" : "hot"}>
          {run.status.replaceAll("_", " ")}
        </StatusBadge>
      </header>
      {run.status === "FAILED" ? (
        <p className="form-error">{run.failureMessage ?? run.failureCode ?? "Briefing failed"}</p>
      ) : (
        <div className="briefing-grid">
          <section>
            <strong>Summary</strong>
            <span>{summary}</span>
          </section>
          <section>
            <strong>Requirements</strong>
            <span>{textField(output.requirements) ?? "Unknown"}</span>
          </section>
          <section>
            <strong>Budget / timeline</strong>
            <span>{textField(output.budget) ?? "Budget unknown"}</span>
            <span>{textField(output.timeline) ?? "Timeline unknown"}</span>
          </section>
          <section>
            <strong>Decision context</strong>
            <span>{textField(output.decisionContext) ?? "Unknown"}</span>
          </section>
          <section>
            <strong>Recent communication</strong>
            <span>{textField(output.recentCommunication) ?? "Unknown"}</span>
          </section>
          <section>
            <strong>Recommended next action</strong>
            <span>{recommended}</span>
          </section>
        </div>
      )}
      <details>
        <summary>Evidence used ({run.evidence.length})</summary>
        <div className="correction-history">
          {run.evidence.slice(0, 6).map((item) => (
            <article key={item.id}>
              <strong>{item.sourceType}</strong>
              <span>{item.title}</span>
              <small>{item.id}</small>
            </article>
          ))}
        </div>
      </details>
    </article>
  );
}

function LeadBriefingPanel({
  briefingState,
  lead,
  onGenerate
}: {
  briefingState: BriefingState;
  lead: LeadDto;
  onGenerate: () => Promise<void>;
}): React.JSX.Element {
  const latest = briefingState.leadBriefings[0] ?? null;

  return (
    <div className="tab-panel ai-insights-panel">
      <section className="meeting-editor" aria-label="Lead briefing">
        <header className="proposal-editor-head">
          <div>
            <p className="eyebrow">AI Insights</p>
            <h3>Grounded Lead Briefing</h3>
          </div>
          <StatusBadge>{briefingState.leadBriefings.length}</StatusBadge>
        </header>
        <p className="muted">
          Advisory briefing from persisted lead, qualification, conversation, proposal, meeting and
          approved-KB evidence only.
        </p>
        <div className="proposal-actions">
          <button
            disabled={briefingState.saving || !lead.id}
            onClick={() => void onGenerate()}
            type="button"
          >
            <Icon name="sparkles" size={16} />
            Generate briefing
          </button>
        </div>
        {briefingState.error ? <p className="form-error">{briefingState.error}</p> : null}
      </section>
      {briefingState.loading ? (
        <StateBlock title="Loading briefings" />
      ) : latest ? (
        <BriefingCard run={latest} />
      ) : (
        <StateBlock title="No lead briefing yet" detail="Generate one from real persisted evidence." />
      )}
    </div>
  );
}

function MeetingPanel({
  briefingState,
  lead,
  meetingState,
  onConfirm,
  onDraftChange,
  onGenerateBriefing,
  onRefresh,
  onRequest
}: {
  briefingState: BriefingState;
  lead: LeadDto;
  meetingState: MeetingState;
  onConfirm: (meetingRequestId: string, slotId: string) => Promise<void>;
  onDraftChange: (patch: Partial<MeetingState>) => void;
  onGenerateBriefing: (meetingRequestId: string) => Promise<void>;
  onRefresh: (leadId: string) => Promise<void>;
  onRequest: () => Promise<void>;
}): React.JSX.Element {
  const canRequest =
    meetingState.windowStart.trim().length > 0 && meetingState.windowEnd.trim().length > 0;

  return (
    <div className="tab-panel meeting-panel">
      <section className="meeting-editor" aria-label="Meeting scheduling">
        <header className="proposal-editor-head">
          <div>
            <p className="eyebrow">Meetings</p>
            <h3>Request Real Calendar Slots</h3>
          </div>
          <StatusBadge>{meetingState.requests.length}</StatusBadge>
        </header>

        <label className="proposal-field">
          Title
          <input
            disabled={meetingState.saving}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            placeholder={`Meeting with ${lead.contact.firstName} ${lead.contact.lastName}`}
            value={meetingState.title}
          />
        </label>
        <div className="meeting-time-grid">
          <label className="proposal-field">
            Window start
            <input
              disabled={meetingState.saving}
              onChange={(event) => onDraftChange({ windowStart: event.target.value })}
              type="datetime-local"
              value={meetingState.windowStart}
            />
          </label>
          <label className="proposal-field">
            Window end
            <input
              disabled={meetingState.saving}
              onChange={(event) => onDraftChange({ windowEnd: event.target.value })}
              type="datetime-local"
              value={meetingState.windowEnd}
            />
          </label>
          <label className="proposal-field">
            Minutes
            <input
              disabled={meetingState.saving}
              min={15}
              max={240}
              onChange={(event) =>
                onDraftChange({ durationMinutes: Number(event.target.value) || 30 })
              }
              type="number"
              value={meetingState.durationMinutes}
            />
          </label>
        </div>

        <div className="proposal-actions meeting-actions">
          <button
            disabled={!canRequest || meetingState.saving}
            onClick={() => void onRequest()}
            type="button"
          >
            <Icon name="check" size={16} />
            Request slots
          </button>
          <button
            disabled={meetingState.saving}
            onClick={() => void onRefresh(lead.id)}
            type="button"
          >
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        </div>

        {meetingState.error ? <p className="form-error">{meetingState.error}</p> : null}
      </section>

      {meetingState.loading ? (
        <StateBlock title="Loading meeting requests" />
      ) : meetingState.requests.length === 0 ? (
        <StateBlock
          title="No meeting requests"
          detail="Create a request to pull real availability from the configured calendar."
        />
      ) : (
        <div className="proposal-list" aria-label="Meeting requests">
          {meetingState.requests.map((request) => {
            const briefing = briefingState.meetingBriefings.find(
              (item) => item.meetingRequestId === request.id
            );
            return (
            <article className="proposal-list-item" key={request.id}>
              <strong>{request.title}</strong>
              <span>{request.status.replaceAll("_", " ")}</span>
              <small>
                Provider {request.providerSyncStatus.replaceAll("_", " ")} · Zoho{" "}
                {request.zohoSyncStatus.replaceAll("_", " ")}
              </small>
              {request.providerLastError ? <small>{request.providerLastError}</small> : null}
              {request.partyNotificationNote ? (
                <small>{request.partyNotificationNote}</small>
              ) : null}
              {briefing ? <BriefingCard run={briefing} /> : null}
              {request.slots
                .filter((slot) => slot.status === "PROPOSED")
                .slice(0, 4)
                .map((slot) => (
                  <button
                    disabled={meetingState.saving || request.status !== "CONFIRMATION_REQUIRED"}
                    key={slot.id}
                    onClick={() => void onConfirm(request.id, slot.id)}
                    type="button"
                  >
                    <Icon name="check" size={15} />
                    {formatDate(slot.startsAt)}
                  </button>
                ))}
              <button
                disabled={briefingState.saving}
                onClick={() => void onGenerateBriefing(request.id)}
                type="button"
              >
                <Icon name="sparkles" size={15} />
                Briefing
              </button>
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProposalReviewPanel({
  currentUser,
  proposalState,
  onApprove,
  onCorrection,
  onDraftChange,
  onRefresh,
  onSave,
  onSelect,
  onSend
}: {
  currentUser: PublicUser;
  proposalState: ProposalState;
  onApprove: () => Promise<void>;
  onCorrection: () => Promise<void>;
  onDraftChange: (
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent" | "correctionSummary">>
  ) => void;
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
              <Icon name="refresh" size={16} />
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

          <section className="correction-panel" aria-label="Agent feedback correction">
            <header>
              <div>
                <p className="eyebrow">Agent Feedback</p>
                <h4>Record correction evidence</h4>
              </div>
              <StatusBadge tone="neutral">{proposalState.corrections.length}</StatusBadge>
            </header>
            <label className="proposal-field">
              Correction summary
              <textarea
                disabled={proposalState.correctionSaving}
                onChange={(event) => onDraftChange({ correctionSummary: event.target.value })}
                rows={3}
                value={proposalState.correctionSummary}
              />
            </label>
            <div className="proposal-actions">
              <button
                disabled={
                  proposalState.correctionSaving ||
                  proposalState.correctionSummary.trim().length < 3 ||
                  !selectedProposal.currentVersion
                }
                onClick={() => void onCorrection()}
                type="button"
              >
                <Icon name="check" size={16} />
                Record correction
              </button>
            </div>
            {proposalState.corrections.length > 0 ? (
              <div className="correction-history">
                {proposalState.corrections.slice(0, 3).map((correction) => (
                  <article key={correction.id}>
                    <strong>v{correction.version} correction</strong>
                    <span>{correction.correctionSummary}</span>
                    <small>
                      {correction.agentModule} · {formatDate(correction.createdAt)}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No correction evidence recorded for this proposal.</p>
            )}
          </section>

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
              <Icon name="check" size={16} />
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
              <Icon name="check" size={16} />
              Approve
            </button>
            <button
              disabled={!canSend || proposalState.saving || !selectedProposal.approvedVersion}
              onClick={() => void onSend()}
              type="button"
            >
              <Icon name="send" size={16} />
              Send approved
            </button>
            <button disabled={proposalState.saving} onClick={() => void onRefresh()} type="button">
              <Icon name="refresh" size={16} />
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
  onStartConversation,
  onStartHumanTakeover
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  lead: LeadDto;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
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
                <Icon name="sparkles" size={16} />
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
        <button
          disabled={conversationState.saving || selectedConversation.mode === "HUMAN"}
          onClick={() => void onStartHumanTakeover()}
          type="button"
        >
          <Icon name="users" size={16} />
          Take over
        </button>
      </div>

      {conversationState.error ? <p className="form-error">{conversationState.error}</p> : null}
      {conversationState.takeoverBriefing ? (
        <HumanTakeoverBriefing briefing={conversationState.takeoverBriefing} />
      ) : null}

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
          <Icon name="send" size={16} />
          Save inbound
        </button>
      </form>
    </div>
  );
}

function HumanTakeoverBriefing({
  briefing
}: {
  briefing: HumanTakeoverBriefingDto;
}): React.JSX.Element {
  const qualification = briefing.qualification;
  const latestProposal = briefing.proposalContext.proposals[0] ?? null;

  return (
    <section className="takeover-briefing" aria-label="Human takeover briefing">
      <header>
        <div>
          <strong>Human takeover active</strong>
          <span>
            {briefing.takeover.takenOverBy.firstName} {briefing.takeover.takenOverBy.lastName}
          </span>
        </div>
        <StatusBadge tone="warm">{briefing.takeover.status}</StatusBadge>
      </header>
      <div className="briefing-grid">
        <section>
          <strong>Requirements</strong>
          <span>{briefing.requirements.requirement ?? "No requirement captured"}</span>
          <span>{briefing.requirements.serviceInterest ?? "No service interest captured"}</span>
        </section>
        <section>
          <strong>Qualification</strong>
          <span>{qualification.need ?? "Need unknown"}</span>
          <span>{qualification.timeline ?? "Timeline unknown"}</span>
          <span>{qualification.budget ?? qualification.budgetBand ?? "Budget unknown"}</span>
        </section>
        <section>
          <strong>Proposal / deal</strong>
          <span>{latestProposal ? latestProposal.status.replaceAll("_", " ") : "No proposal"}</span>
          <span>
            {briefing.dealContext.deal
              ? `${briefing.dealContext.deal.status} at ${String(
                  briefing.dealContext.deal.probability
                )}%`
              : "No deal record"}
          </span>
        </section>
        <section>
          <strong>Latest actions</strong>
          {briefing.latestActions.slice(0, 4).map((activity) => (
            <span key={activity.id}>{activity.type.replaceAll("_", " ")}</span>
          ))}
        </section>
      </div>
    </section>
  );
}
