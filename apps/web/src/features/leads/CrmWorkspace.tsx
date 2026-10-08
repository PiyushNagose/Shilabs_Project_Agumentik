import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONVERSATION_MODES,
  type ActivityDto,
  type AgentCorrectionDto,
  type BriefingRunDto,
  type ConversationDto,
  type ConversationModeName,
  type FollowUpSequenceDto,
  type HumanConversationReplyDto,
  type HumanTakeoverBriefingDto,
  type InternalNotificationDto,
  type LeadDto,
  type LeadQualificationDto,
  type LeadTemperatureName,
  type MeetingRequestDto,
  type MessageDto,
  type PaginatedResponse,
  type PipelineStageDto,
  type ProposalDto,
  type ProposalSendResultDto,
  type PublicUser,
  type TaskDto,
  type ZohoLeadContactSyncDto
} from "@shilabs/shared-types";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { useToast } from "../../components/ToastProvider.js";
import { Select } from "../../components/ui/index.js";
import {
  accelerateFollowUpSequenceForE2E,
  assignLead,
  apiErrorMessage,
  appendConversationMessage,
  acknowledgeNotification,
  approveProposal,
  confirmMeetingRequest,
  createProposalAgentCorrection,
  completeTask,
  createConversation,
  createMeetingRequest,
  generateLeadBriefing,
  generateMeetingBriefing,
  generateProposal,
  getLead,
  getHumanTakeoverBriefing,
  getLeadQualification,
  listBriefings,
  listConversationMessages,
  listConversations,
  listFollowUpSequences,
  listLeadActivities,
  listLeads,
  listMeetingRequests,
  listNotifications,
  listPipelineStages,
  listProposals,
  listTasks,
  listAgentCorrections,
  listUsers,
  markNotificationRead,
  processInboundReply,
  sendApprovedProposal,
  sendHumanConversationReply,
  runCallingAttemptNowForE2E,
  startFollowUpSequence,
  startHumanTakeover,
  syncZohoLeadContacts,
  submitE2ECustomerReply,
  updateConversationMode,
  updateLeadStage,
  updateProposalDraft,
  type LeadListParams
} from "../../services/api-client.js";
import { useRealtime, type RealtimeUpdateEvent } from "../realtime/RealtimeProvider.js";
import {
  LeadFactStrip,
  LeadQuickView,
  LeadTaskList,
  LeadTimeline,
  leadName,
  leadPriority
} from "./LeadExperience.js";

function isE2ELocalUi(): boolean {
  const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
  return viteEnv.VITE_APP_ENV === "e2e-local";
}

type WorkspaceView = "leads" | "pipeline";
export type DetailTab =
  | "Overview"
  | "Conversation"
  | "Qualification"
  | "Proposals"
  | "Activities"
  | "Tasks"
  | "Meetings"
  | "Deal"
  | "AI Insights";

const detailTabs: DetailTab[] = [
  "Overview",
  "Conversation",
  "Qualification",
  "Proposals",
  "Activities",
  "Tasks",
  "Meetings",
  "Deal",
  "AI Insights"
];

interface CrmWorkspaceProps {
  accessToken: string;
  currentUser: PublicUser;
  initialLeadId?: string | null;
  initialTab?: DetailTab;
  onRouteChange?: (leadId: string | null, tab?: DetailTab) => void;
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
  followUpSequences: FollowUpSequenceDto[];
  takeoverBriefing: HumanTakeoverBriefingDto | null;
  input: string;
  humanReplyInput: string;
  e2eReplyInput: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface QualificationState {
  qualification: LeadQualificationDto | null;
  loading: boolean;
  error: string | null;
}

interface TaskState {
  tasks: TaskDto[];
  loading: boolean;
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
  generating: boolean;
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

interface ZohoSyncState {
  syncing: boolean;
  result: ZohoLeadContactSyncDto | null;
  error: string | null;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeInputValue(date: Date): string {
  return `${String(date.getFullYear())}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function nextBusinessWindow(): { windowStart: string; windowEnd: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(17, 0, 0, 0);
  return {
    windowStart: toLocalDateTimeInputValue(start),
    windowEnd: toLocalDateTimeInputValue(end)
  };
}

function createInitialMeetingState(): MeetingState {
  const window = nextBusinessWindow();
  return {
    requests: [],
    title: "",
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    durationMinutes: 30,
    loading: false,
    saving: false,
    error: null
  };
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
  followUpSequences: [],
  takeoverBriefing: null,
  input: "",
  humanReplyInput: "",
  e2eReplyInput: "",
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
  generating: false,
  correctionSaving: false,
  error: null,
  sendResult: null
};

const initialBriefingState: BriefingState = {
  leadBriefings: [],
  meetingBriefings: [],
  loading: false,
  saving: false,
  error: null
};

const initialQualificationState: QualificationState = {
  qualification: null,
  loading: false,
  error: null
};

export interface CrmRealtimeRefreshPlan {
  fullWorkspace: boolean;
  leadList: boolean;
  lead: boolean;
  conversations: boolean;
  qualification: boolean;
  proposals: boolean;
  meetings: boolean;
  briefings: boolean;
  notifications: boolean;
  tasks: boolean;
}

const emptyRealtimeRefreshPlan: CrmRealtimeRefreshPlan = {
  fullWorkspace: false,
  leadList: false,
  lead: false,
  conversations: false,
  qualification: false,
  proposals: false,
  meetings: false,
  briefings: false,
  notifications: false,
  tasks: false
};

export function mergeCrmRealtimeRefreshPlans(
  current: CrmRealtimeRefreshPlan | null,
  next: CrmRealtimeRefreshPlan
): CrmRealtimeRefreshPlan {
  return {
    fullWorkspace: current?.fullWorkspace === true || next.fullWorkspace,
    leadList: current?.leadList === true || next.leadList,
    lead: current?.lead === true || next.lead,
    conversations: current?.conversations === true || next.conversations,
    qualification: current?.qualification === true || next.qualification,
    proposals: current?.proposals === true || next.proposals,
    meetings: current?.meetings === true || next.meetings,
    briefings: current?.briefings === true || next.briefings,
    notifications: current?.notifications === true || next.notifications,
    tasks: current?.tasks === true || next.tasks
  };
}

export function planCrmRealtimeRefresh(
  event: RealtimeUpdateEvent,
  selectedLeadId: string | null
): CrmRealtimeRefreshPlan | null {
  if (event.type === "realtime:reconnected") {
    return {
      ...emptyRealtimeRefreshPlan,
      fullWorkspace: true,
      conversations: Boolean(selectedLeadId),
      qualification: Boolean(selectedLeadId),
      proposals: Boolean(selectedLeadId),
      meetings: Boolean(selectedLeadId),
      briefings: Boolean(selectedLeadId),
      notifications: Boolean(selectedLeadId),
      tasks: Boolean(selectedLeadId)
    };
  }

  if (!["workspace", "lead", "task", "notifications", "domain-event"].includes(event.entityType)) {
    return null;
  }

  const affectsSelectedLead = !event.leadId || event.leadId === selectedLeadId;
  const plan: CrmRealtimeRefreshPlan = {
    ...emptyRealtimeRefreshPlan,
    leadList: true
  };
  if (!selectedLeadId || !affectsSelectedLead) {
    return plan;
  }

  if (event.entityType === "notifications") {
    return { ...plan, notifications: true };
  }

  const scope = [event.entityType, event.action, event.sourceEventType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const includesAny = (values: string[]): boolean => values.some((value) => scope.includes(value));

  plan.lead = true;
  plan.notifications = true;

  if (
    includesAny(["conversation", "message", "reply", "email", "followup", "follow-up", "whatsapp"])
  ) {
    plan.conversations = true;
    plan.qualification = true;
  }
  if (includesAny(["score", "qualification", "reply_understood"])) {
    plan.qualification = true;
  }
  if (includesAny(["proposal"])) {
    plan.proposals = true;
  }
  if (includesAny(["meeting"])) {
    plan.meetings = true;
  }
  if (includesAny(["briefing", "insight"])) {
    plan.briefings = true;
  }
  if (event.entityType === "task" || includesAny(["task"])) {
    plan.tasks = true;
  }
  if (event.entityType === "domain-event" && !event.sourceEventType) {
    plan.conversations = true;
    plan.qualification = true;
    plan.proposals = true;
    plan.meetings = true;
  }

  return plan;
}

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
    return "Not set";
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

function formatZohoSyncResult(result: ZohoLeadContactSyncDto): string {
  const status = result.status.replaceAll("_", " ").toLowerCase();
  const failed = result.failedRecords > 0 ? `, ${String(result.failedRecords)} failed` : "";
  const skipped = result.skippedRecords > 0 ? `, ${String(result.skippedRecords)} skipped` : "";
  const imported = `${String(result.succeededRecords)}/${String(result.totalRecords)} imported`;
  return `Zoho sync ${status}: ${imported}${failed}${skipped}`;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function qualificationValue(
  qualification: LeadQualificationDto | null,
  key: keyof Pick<
    LeadQualificationDto,
    | "need"
    | "requirement"
    | "budget"
    | "budgetBand"
    | "authority"
    | "timeline"
    | "businessFit"
    | "urgency"
  >,
  fallback: string | null | undefined,
  unknownLabel: string
): string {
  const extracted = qualification?.[key];
  if (hasText(extracted)) {
    return extracted;
  }

  if (hasText(fallback)) {
    return fallback;
  }

  return unknownLabel;
}

function decisionMakerValue(qualification: LeadQualificationDto | null): string {
  if (qualification?.decisionMakerIdentified === true) {
    return "Yes";
  }

  if (qualification?.decisionMakerIdentified === false) {
    return "No";
  }

  return "Unknown";
}

function budgetValue(qualification: LeadQualificationDto | null): string {
  if (hasText(qualification?.budget)) {
    return qualification.budget;
  }

  if (hasText(qualification?.budgetBand)) {
    return qualification.budgetBand;
  }

  return "Budget unknown";
}

export function CrmWorkspace({
  accessToken,
  currentUser,
  initialLeadId = null,
  initialTab,
  onRouteChange
}: CrmWorkspaceProps): React.JSX.Element {
  const toast = useToast();
  const { subscribe } = useRealtime();
  const [view, setView] = useState<WorkspaceView>("leads");
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab ?? "Overview");
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
  const [qualificationState, setQualificationState] =
    useState<QualificationState>(initialQualificationState);
  const [taskState, setTaskState] = useState<TaskState>({ tasks: [], loading: false, error: null });
  const [workspaceTasks, setWorkspaceTasks] = useState<TaskDto[]>([]);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [proposalState, setProposalState] = useState<ProposalState>(initialProposalState);
  const [meetingState, setMeetingState] = useState<MeetingState>(() => createInitialMeetingState());
  const [briefingState, setBriefingState] = useState<BriefingState>(initialBriefingState);
  const [zohoSyncState, setZohoSyncState] = useState<ZohoSyncState>({
    syncing: false,
    result: null,
    error: null
  });
  const realtimeRefreshPlanRef = useRef<CrmRealtimeRefreshPlan | null>(null);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const selectedLeadRef = useRef<string | null>(null);
  selectedLeadRef.current = state.selectedLead?.id ?? null;
  const selectionRequestRef = useRef(0);
  const selectionTargetRef = useRef<string | null>(null);
  const detailRequestsRef = useRef<Record<string, number>>({});
  const listRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;
  const proposalStateRef = useRef(proposalState);
  proposalStateRef.current = proposalState;

  function beginDetailRequest(scope: string, leadId: string): () => boolean {
    const request = (detailRequestsRef.current[scope] ?? 0) + 1;
    detailRequestsRef.current[scope] = request;
    const selection = selectionRequestRef.current;
    return () =>
      selectedLeadRef.current === leadId &&
      selectionRequestRef.current === selection &&
      detailRequestsRef.current[scope] === request;
  }

  useEffect(
    () => () => {
      selectionRequestRef.current += 1;
      listRequestRef.current += 1;
      workspaceRequestRef.current += 1;
    },
    [accessToken]
  );

  async function loadWorkspace(
    nextFilters = filters,
    leadId: string | null | undefined = state.selectedLead?.id
  ): Promise<void> {
    const request = ++workspaceRequestRef.current;
    const listRequest = ++listRequestRef.current;
    const selection = selectionRequestRef.current;
    setState((current) => ({ ...current, loading: !current.leadsPage, error: null }));

    try {
      const [leadsPage, stages, users] = await Promise.all([
        listLeads(accessToken, nextFilters),
        listPipelineStages(accessToken),
        listUsers(accessToken).catch(() => [currentUser])
      ]);
      const selectedLead = leadId
        ? await getLead(accessToken, leadId)
        : (leadsPage.items[0] ?? null);
      const activities = selectedLead
        ? await listLeadActivities(accessToken, selectedLead.id).catch(() => [])
        : [];
      const notifications = selectedLead
        ? await listNotifications(accessToken, { leadId: selectedLead.id, limit: 10 }).catch(
            () => []
          )
        : [];
      const qualification = selectedLead
        ? await getLeadQualification(accessToken, selectedLead.id).catch(() => null)
        : null;
      const tasks = selectedLead
        ? await listTasks(accessToken, { leadId: selectedLead.id })
            .then((items) => (Array.isArray(items) ? items : []))
            .catch(() => [])
        : [];
      const allTasks = await listTasks(accessToken, {})
        .then((items) => (Array.isArray(items) ? items : []))
        .catch(() => []);

      if (request !== workspaceRequestRef.current || selection !== selectionRequestRef.current)
        return;
      setState((current) => ({
        leadsPage:
          listRequest === listRequestRef.current ? leadsPage : (current.leadsPage ?? leadsPage),
        stages,
        users,
        selectedLead,
        activities,
        notifications,
        loading: false,
        error: null
      }));
      setQualificationState({
        qualification,
        loading: false,
        error: selectedLead && !qualification ? "Qualification could not be loaded" : null
      });
      setTaskState({ tasks, loading: false, error: null });
      setWorkspaceTasks(allTasks);
    } catch {
      if (request !== workspaceRequestRef.current || selection !== selectionRequestRef.current)
        return;
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
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (
      !initialLeadId ||
      state.loading ||
      state.selectedLead?.id === initialLeadId ||
      selectionTargetRef.current === initialLeadId
    ) {
      return;
    }

    void selectLead(initialLeadId, false);
  }, [initialLeadId, state.loading, state.selectedLead?.id]);

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
    if (activeTab === "Tasks" && state.selectedLead) {
      void loadLeadTasks(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  useEffect(() => {
    if (activeTab === "AI Insights" && state.selectedLead) {
      void loadLeadBriefings(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  useEffect(() => {
    const clearRefreshTimer = (): void => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
    };
    const flushRefresh = (): void => {
      const plan = realtimeRefreshPlanRef.current;
      realtimeRefreshPlanRef.current = null;
      realtimeRefreshTimerRef.current = null;
      if (!plan) return;

      const selectedLeadId = state.selectedLead?.id ?? null;
      if (plan.fullWorkspace) {
        void loadWorkspace(filters, selectedLeadId);
      }

      if (plan.leadList && !plan.fullWorkspace) {
        void refreshLeadList(filters);
      }
      if (!selectedLeadId) return;
      if (plan.lead) {
        void refreshSelectedLead(selectedLeadId);
      }
      if (plan.conversations) {
        void loadLeadConversations(selectedLeadId, true);
      }
      if (plan.qualification) {
        void loadLeadQualification(selectedLeadId, true);
      }
      if (plan.proposals) {
        void loadLeadProposals(selectedLeadId, true);
      }
      if (plan.meetings) {
        void loadLeadMeetings(selectedLeadId, true);
      }
      if (plan.briefings) {
        void loadLeadBriefings(selectedLeadId, true);
      }
      if (plan.notifications && !plan.lead) {
        void loadLeadNotifications(selectedLeadId);
      }
      if (plan.tasks) {
        void loadLeadTasks(selectedLeadId, true);
      }
    };

    const unsubscribe = subscribe((event) => {
      const plan = planCrmRealtimeRefresh(event, state.selectedLead?.id ?? null);
      if (!plan) return;
      realtimeRefreshPlanRef.current = mergeCrmRealtimeRefreshPlans(
        realtimeRefreshPlanRef.current,
        plan
      );
      realtimeRefreshTimerRef.current ??= window.setTimeout(flushRefresh, 200);
    });
    return () => {
      unsubscribe();
      clearRefreshTimer();
      realtimeRefreshPlanRef.current = null;
    };
  }, [accessToken, filters, subscribe, state.selectedLead?.id]);

  async function loadLeadConversations(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("conversations", leadId);
    setConversationState((current) => ({ ...current, loading: !background, error: null }));

    try {
      const [conversations, followUpSequences] = await Promise.all([
        listConversations(accessToken, { leadId }),
        listFollowUpSequences(accessToken, leadId)
      ]);
      const currentSelection = conversationStateRef.current.selectedConversation?.id;
      const linkedConversationId = followUpSequences[0]?.conversationId;
      const selectedConversation =
        conversations.find((conversation) => conversation.id === currentSelection) ??
        conversations.find((conversation) => conversation.id === linkedConversationId) ??
        conversations[0] ??
        null;
      const messages = selectedConversation
        ? await listConversationMessages(accessToken, selectedConversation.id)
        : [];
      const takeoverBriefing =
        selectedConversation?.mode === "HUMAN"
          ? await getHumanTakeoverBriefing(accessToken, selectedConversation.id).catch(() => null)
          : null;

      if (!isCurrent()) return;
      setConversationState((current) => ({
        ...current,
        conversations,
        selectedConversation,
        messages,
        followUpSequences,
        takeoverBriefing,
        loading: false,
        error: null
      }));
    } catch {
      if (!isCurrent()) return;
      setConversationState((current) => ({
        ...current,
        loading: false,
        error: "Conversation data could not be loaded"
      }));
    }
  }

  async function loadLeadProposals(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("proposals", leadId);
    setProposalState((current) => ({ ...current, loading: !background, error: null }));

    try {
      const proposals = await listProposals(accessToken, { leadId, limit: 50 });
      const selectedProposal =
        proposals.find((proposal) => proposal.id === proposalStateRef.current.selectedProposalId) ??
        proposals[0] ??
        null;
      let corrections: AgentCorrectionDto[] = [];
      let correctionError: string | null = null;
      if (selectedProposal) {
        try {
          corrections = await listAgentCorrections(accessToken, {
            proposalId: selectedProposal.id,
            limit: 10
          });
        } catch (error) {
          if (!isCurrent()) return;
          correctionError = apiErrorMessage(error, "Correction history could not be loaded");
        }
      }

      if (!isCurrent()) return;
      setProposalState((current) => ({
        ...current,
        proposals,
        selectedProposalId: selectedProposal?.id ?? null,
        corrections,
        correctionSummary: current.correctionSummary,
        draftTitle:
          current.selectedProposalId === selectedProposal?.id &&
          current.draftTitle !==
            current.proposals.find((item) => item.id === selectedProposal.id)?.title
            ? current.draftTitle
            : (selectedProposal?.title ?? ""),
        draftContent:
          current.selectedProposalId === selectedProposal?.id &&
          current.draftContent !==
            (current.proposals.find((item) => item.id === selectedProposal.id)?.currentVersion
              ?.content ?? "")
            ? current.draftContent
            : (selectedProposal?.currentVersion?.content ?? ""),
        loading: false,
        error: correctionError,
        sendResult: current.sendResult
      }));
    } catch (error) {
      if (!isCurrent()) return;
      setProposalState((current) => ({
        ...current,
        loading: false,
        error: apiErrorMessage(error, "Proposals could not be loaded")
      }));
    }
  }

  async function loadProposalCorrections(proposalId: string): Promise<AgentCorrectionDto[]> {
    return listAgentCorrections(accessToken, { proposalId, limit: 10 });
  }

  async function loadLeadMeetings(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("meetings", leadId);
    setMeetingState((current) => ({ ...current, loading: !background, error: null }));

    try {
      const requests = await listMeetingRequests(accessToken, { leadId, limit: 50 });
      if (!isCurrent()) return;
      setMeetingState((current) => ({
        ...current,
        requests,
        loading: false,
        error: null
      }));
    } catch {
      if (!isCurrent()) return;
      setMeetingState((current) => ({
        ...current,
        loading: false,
        error: "Meeting requests could not be loaded"
      }));
    }
  }

  async function loadLeadTasks(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("tasks", leadId);
    setTaskState((current) => ({ ...current, loading: !background, error: null }));
    try {
      const result = await listTasks(accessToken, { leadId });
      if (!isCurrent()) return;
      const tasks = Array.isArray(result) ? result : [];
      setTaskState({ tasks, loading: false, error: null });
      setWorkspaceTasks((current) => [
        ...current.filter((task) => task.leadId !== leadId),
        ...tasks
      ]);
    } catch (error) {
      if (!isCurrent()) return;
      setTaskState((current) => ({
        ...current,
        loading: false,
        error: apiErrorMessage(error, "Tasks could not be loaded")
      }));
    }
  }

  async function loadLeadBriefings(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("briefings", leadId);
    setBriefingState((current) => ({ ...current, loading: !background, error: null }));

    try {
      const [leadBriefings, meetingBriefings] = await Promise.all([
        listBriefings(accessToken, { leadId, kind: "LEAD", limit: 10 }),
        listBriefings(accessToken, { leadId, kind: "MEETING", limit: 20 })
      ]);
      if (!isCurrent()) return;
      setBriefingState((current) => ({
        ...current,
        leadBriefings,
        meetingBriefings,
        loading: false,
        error: null
      }));
    } catch {
      if (!isCurrent()) return;
      setBriefingState((current) => ({
        ...current,
        loading: false,
        error: "Briefings could not be loaded"
      }));
    }
  }

  async function loadLeadQualification(leadId: string, background = false): Promise<void> {
    const isCurrent = beginDetailRequest("qualification", leadId);
    setQualificationState((current) => ({ ...current, loading: !background, error: null }));

    try {
      const qualification = await getLeadQualification(accessToken, leadId);
      if (!isCurrent()) return;
      setQualificationState({ qualification, loading: false, error: null });
    } catch {
      if (!isCurrent()) return;
      setQualificationState((current) => ({
        ...current,
        loading: false,
        error: "Qualification could not be loaded"
      }));
    }
  }

  async function refreshLeadList(nextFilters = filters): Promise<void> {
    const request = ++listRequestRef.current;
    try {
      const leadsPage = await listLeads(accessToken, nextFilters);
      if (request !== listRequestRef.current) return;
      setState((current) => ({ ...current, leadsPage, error: null }));
    } catch {
      if (request === listRequestRef.current) {
        setState((current) => ({ ...current, error: "Lead list could not be refreshed" }));
      }
    }
  }

  async function refreshSelectedLead(leadId: string): Promise<void> {
    const isCurrent = beginDetailRequest("lead", leadId);
    try {
      const [lead, activities, notifications] = await Promise.all([
        getLead(accessToken, leadId),
        listLeadActivities(accessToken, leadId).catch(() => state.activities),
        listNotifications(accessToken, { leadId, limit: 10 }).catch(() => state.notifications)
      ]);
      if (!isCurrent()) return;
      setState((current) => {
        if (current.selectedLead?.id !== leadId) {
          return current;
        }
        const leadsPage = current.leadsPage
          ? {
              ...current.leadsPage,
              items: current.leadsPage.items.map((item) => (item.id === lead.id ? lead : item))
            }
          : current.leadsPage;
        return { ...current, leadsPage, selectedLead: lead, activities, notifications };
      });
    } catch {
      // Keep the currently selected lead stable; the next explicit refresh will reconcile.
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
    await refreshLeadList(merged);
  }

  async function syncZohoLeadsContacts(): Promise<void> {
    setZohoSyncState({ syncing: true, result: null, error: null });

    try {
      const result = await syncZohoLeadContacts(accessToken);
      setZohoSyncState({ syncing: false, result, error: null });
      await loadWorkspace(filters);
      toast.success({
        title: "Zoho sync completed",
        detail: `${String(result.succeededRecords)}/${String(result.totalRecords)} records imported`
      });
    } catch (error) {
      const message = apiErrorMessage(error, "Zoho lead/contact sync could not be started");
      setZohoSyncState({
        syncing: false,
        result: null,
        error: message
      });
      toast.error({ title: "Zoho sync failed", detail: message });
    }
  }

  async function selectLead(leadId: string, updateRoute = true): Promise<void> {
    const request = ++selectionRequestRef.current;
    selectionTargetRef.current = leadId;
    if (updateRoute) {
      onRouteChange?.(leadId, activeTab);
    }
    try {
      const [lead, activities, notifications, qualification, tasks, meetings] = await Promise.all([
        getLead(accessToken, leadId),
        listLeadActivities(accessToken, leadId).catch(() => []),
        listNotifications(accessToken, { leadId, limit: 10 }).catch(() => []),
        getLeadQualification(accessToken, leadId).catch(() => null),
        listTasks(accessToken, { leadId })
          .then((items) => (Array.isArray(items) ? items : []))
          .catch(() => []),
        listMeetingRequests(accessToken, { leadId, limit: 50 }).catch(() => [])
      ]);
      if (request !== selectionRequestRef.current) return;
      selectedLeadRef.current = leadId;
      setState((current) => ({ ...current, selectedLead: lead, activities, notifications }));
      setQualificationState({
        qualification,
        loading: false,
        error: qualification ? null : "Qualification could not be loaded"
      });
      setTaskState({ tasks, loading: false, error: null });
      setConversationState(initialConversationState);
      setProposalState(initialProposalState);
      setMeetingState({ ...createInitialMeetingState(), requests: meetings });
      setBriefingState(initialBriefingState);
    } catch (error) {
      if (request === selectionRequestRef.current) {
        toast.error({
          title: "Lead could not be loaded",
          detail: apiErrorMessage(error, "Please retry")
        });
      }
    } finally {
      if (request === selectionRequestRef.current) selectionTargetRef.current = null;
    }
  }

  async function openQuickView(leadId: string): Promise<void> {
    setQuickViewOpen(true);
    setTaskState({ tasks: [], loading: true, error: null });
    await selectLead(leadId, false);
  }

  async function completeLeadTask(taskId: string): Promise<void> {
    try {
      const completed = await completeTask(accessToken, taskId);
      setTaskState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === completed.id ? completed : task))
      }));
      setWorkspaceTasks((current) =>
        current.map((task) => (task.id === completed.id ? completed : task))
      );
      if (state.selectedLead) await refreshSelectedLead(state.selectedLead.id);
      toast.success({ title: "Task completed" });
    } catch (error) {
      toast.error({
        title: "Task could not be completed",
        detail: apiErrorMessage(error, "Please retry")
      });
    }
  }

  async function loadLeadNotifications(leadId: string): Promise<void> {
    const isCurrent = beginDetailRequest("notifications", leadId);
    const notifications = await listNotifications(accessToken, { leadId, limit: 10 }).catch(
      () => state.notifications
    );
    if (isCurrent()) setState((current) => ({ ...current, notifications }));
  }

  function changeDetailTab(tab: DetailTab): void {
    setActiveTab(tab);
    onRouteChange?.(state.selectedLead?.id ?? initialLeadId ?? null, tab);
  }

  async function persistStage(stageId: string): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    try {
      const lead = await updateLeadStage(accessToken, state.selectedLead.id, stageId);
      setState((current) => ({
        ...current,
        selectedLead: current.selectedLead?.id === lead.id ? lead : current.selectedLead,
        leadsPage: current.leadsPage
          ? {
              ...current.leadsPage,
              items: current.leadsPage.items.map((item) => (item.id === lead.id ? lead : item))
            }
          : current.leadsPage
      }));
      await Promise.all([refreshLeadList(filters), refreshSelectedLead(lead.id)]);
      toast.success({ title: "Stage updated", detail: lead.stage.label });
    } catch (error) {
      toast.error({
        title: "Stage update failed",
        detail: apiErrorMessage(error, "Lead stage could not be updated")
      });
    }
  }

  async function persistOwner(ownerId: string): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    try {
      const lead = await assignLead(accessToken, state.selectedLead.id, ownerId || null);
      setState((current) => ({
        ...current,
        selectedLead: current.selectedLead?.id === lead.id ? lead : current.selectedLead,
        leadsPage: current.leadsPage
          ? {
              ...current.leadsPage,
              items: current.leadsPage.items.map((item) => (item.id === lead.id ? lead : item))
            }
          : current.leadsPage
      }));
      toast.success({
        title: "Owner updated",
        detail: lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"
      });
    } catch (error) {
      toast.error({
        title: "Owner update failed",
        detail: apiErrorMessage(error, "Lead owner could not be updated")
      });
    }
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
      toast.success({ title: "Simulator conversation started" });
    } catch (error) {
      const message = apiErrorMessage(error, "Conversation could not be started");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Conversation start failed", detail: message });
    }
  }

  async function startProductionFollowUp(): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));

    try {
      const sequence = await startFollowUpSequence(accessToken, state.selectedLead.id, {
        idempotencyKey: `crm-follow-up:${state.selectedLead.id}`
      });
      const [conversations, followUpSequences] = await Promise.all([
        listConversations(accessToken, { leadId: state.selectedLead.id }),
        listFollowUpSequences(accessToken, state.selectedLead.id).catch(() => [sequence])
      ]);
      const selectedConversation =
        conversations.find((conversation) => conversation.id === sequence.conversationId) ??
        conversations[0] ??
        null;
      const messages = selectedConversation
        ? await listConversationMessages(accessToken, selectedConversation.id).catch(() => [])
        : [];
      setConversationState((current) => ({
        ...current,
        conversations,
        selectedConversation,
        messages,
        followUpSequences,
        loading: false,
        saving: false,
        error: null
      }));
      const leadId = state.selectedLead.id;
      await Promise.all([
        refreshLeadList(filters),
        refreshSelectedLead(leadId),
        loadLeadNotifications(leadId),
        listLeadActivities(accessToken, leadId)
          .catch(() => state.activities)
          .then((activities) => setState((current) => ({ ...current, activities })))
      ]);
      toast.success({
        title: "Follow-up automation started",
        detail: sequence.status.replaceAll("_", " ")
      });
    } catch (error) {
      const message = apiErrorMessage(error, "Follow-up automation could not be started");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Follow-up start failed", detail: message });
    }
  }

  async function accelerateProductionFollowUpForE2E(sequenceId: string): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));

    try {
      const accelerated = await accelerateFollowUpSequenceForE2E(accessToken, sequenceId);
      const followUpSequences = await listFollowUpSequences(
        accessToken,
        state.selectedLead.id
      ).catch(() => [accelerated]);
      setConversationState((current) => ({
        ...current,
        followUpSequences:
          followUpSequences.length > 0
            ? followUpSequences
            : current.followUpSequences.map((sequence) =>
                sequence.id === accelerated.id ? accelerated : sequence
              ),
        saving: false,
        error: null
      }));
      toast.success({ title: "E2E cadence applied" });
    } catch (error) {
      const message = apiErrorMessage(error, "E2E follow-up acceleration could not be applied");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "E2E acceleration failed", detail: message });
    }
  }

  async function runAiCallNowForE2E(): Promise<void> {
    if (!state.selectedLead) return;
    setConversationState((current) => ({ ...current, saving: true, error: null }));
    try {
      const result = await runCallingAttemptNowForE2E(accessToken, state.selectedLead.id);
      setConversationState((current) => ({ ...current, saving: false }));
      const leadId = state.selectedLead.id;
      await Promise.all([
        refreshLeadList(filters),
        refreshSelectedLead(leadId),
        loadLeadConversations(leadId),
        loadLeadNotifications(leadId),
        listLeadActivities(accessToken, leadId)
          .catch(() => state.activities)
          .then((activities) => setState((current) => ({ ...current, activities })))
      ]);
      toast.success({ title: "AI call queued", detail: result.status.replaceAll("_", " ") });
    } catch (error) {
      const message = apiErrorMessage(error, "AI call could not be queued");
      setConversationState((current) => ({ ...current, saving: false, error: message }));
      toast.error({ title: "AI call failed", detail: message });
    }
  }

  async function selectConversation(conversationId: string): Promise<void> {
    const isCurrent = beginDetailRequest("conversations", state.selectedLead?.id ?? "");
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
      if (!isCurrent()) return;
      setConversationState((current) => ({
        ...current,
        messages,
        takeoverBriefing,
        loading: false,
        error: null
      }));
    } catch {
      if (!isCurrent()) return;
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

    try {
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
      toast.success({ title: "Conversation mode updated", detail: mode.replaceAll("_", " ") });
    } catch (error) {
      toast.error({
        title: "Mode update failed",
        detail: apiErrorMessage(error, "Conversation mode could not be updated")
      });
    }
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
      toast.success({ title: "Human takeover started" });
    } catch (error) {
      const message = apiErrorMessage(error, "Human takeover could not be started");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Human takeover failed", detail: message });
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
      toast.success({ title: "Inbound message saved" });
    } catch (error) {
      const message = apiErrorMessage(error, "Message could not be saved");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Message save failed", detail: message });
    }
  }

  async function sendHumanReply(): Promise<void> {
    if (!state.selectedLead || !conversationState.selectedConversation) {
      return;
    }
    const body = conversationState.humanReplyInput.trim();
    if (!body) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `human-reply-${Date.now().toString()}`;
      const result: HumanConversationReplyDto = await sendHumanConversationReply(
        accessToken,
        conversationState.selectedConversation.id,
        {
          body,
          idempotencyKey
        }
      );
      const leadId = state.selectedLead.id;
      await Promise.all([
        refreshLeadList(filters),
        refreshSelectedLead(leadId),
        loadLeadConversations(leadId),
        loadLeadNotifications(leadId),
        listLeadActivities(accessToken, leadId)
          .catch(() => state.activities)
          .then((activities) => setState((current) => ({ ...current, activities })))
      ]);
      setConversationState((current) => ({
        ...current,
        humanReplyInput: "",
        saving: false,
        error: null
      }));
      if (result.outboundEmail.status === "SENT") {
        toast.success({
          title: "Human reply sent",
          detail: result.zohoTimeline?.status
            ? `Zoho timeline ${result.zohoTimeline.status.replaceAll("_", " ").toLowerCase()}`
            : undefined
        });
      } else {
        toast.error({
          title: "Human reply not sent",
          detail: result.outboundEmail.failureMessage ?? result.outboundEmail.status
        });
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Human reply could not be sent");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Human reply failed", detail: message });
    }
  }

  async function submitE2ECustomerReplyFromConversation(): Promise<void> {
    if (!state.selectedLead || !isE2ELocalUi() || currentUser.role !== "ADMIN") {
      return;
    }

    const body = conversationState.e2eReplyInput.trim();
    if (!body) {
      return;
    }

    setConversationState((current) => ({ ...current, saving: true, error: null }));

    try {
      const inbound = await submitE2ECustomerReply(accessToken, {
        leadId: state.selectedLead.id,
        subject:
          `E2E Customer Reply - ${state.selectedLead.contact.firstName} ${state.selectedLead.contact.lastName}`.trim(),
        body
      });
      if (inbound.inboundEmail.status === "PROCESSED") {
        await processInboundReply(accessToken, inbound.inboundEmail.id);
      }
      const leadId = state.selectedLead.id;
      await Promise.all([
        refreshLeadList(filters),
        refreshSelectedLead(leadId),
        loadLeadConversations(leadId),
        loadLeadQualification(leadId),
        loadLeadMeetings(leadId),
        loadLeadNotifications(leadId),
        listLeadActivities(accessToken, leadId)
          .catch(() => state.activities)
          .then((activities) => setState((current) => ({ ...current, activities })))
      ]);
      setConversationState((current) => ({
        ...current,
        e2eReplyInput: "",
        saving: false,
        error: null
      }));
      toast.success({ title: "Customer reply processed" });
    } catch (error) {
      const message = apiErrorMessage(error, "E2E customer reply could not be ingested");
      setConversationState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Customer reply failed", detail: message });
    }
  }

  function selectProposal(proposalId: string): void {
    detailRequestsRef.current.proposals = (detailRequestsRef.current.proposals ?? 0) + 1;
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
        corrections: [
          correction,
          ...current.corrections.filter((item) => item.id !== correction.id)
        ],
        correctionSummary: "",
        correctionSaving: false,
        error: null
      }));
      toast.success({ title: "Correction recorded" });
    } catch (error) {
      const message = apiErrorMessage(error, "Correction could not be recorded");
      setProposalState((current) => ({
        ...current,
        correctionSaving: false,
        error: message
      }));
      toast.error({ title: "Correction failed", detail: message });
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
      toast.success({ title: "Proposal draft saved" });
    } catch (error) {
      const message = apiErrorMessage(error, "Draft could not be saved");
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Draft save failed", detail: message });
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
      toast.success({ title: "Proposal approved" });
    } catch (error) {
      const message = apiErrorMessage(error, "Proposal could not be approved");
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Proposal approval failed", detail: message });
    }
  }

  async function generateSelectedProposal(): Promise<void> {
    if (!state.selectedLead) {
      return;
    }

    setProposalState((current) => ({ ...current, generating: true, error: null }));

    try {
      const result = await generateProposal(accessToken, {
        leadId: state.selectedLead.id,
        kind: "GENERAL",
        idempotencyKey: `crm-proposal-generation:GENERAL:${state.selectedLead.id}`
      });

      if (!result.proposal || result.run.status !== "COMPLETED") {
        const message =
          result.run.failureMessage ??
          result.run.failureCode ??
          "Proposal generation needs attention";
        setProposalState((current) => ({
          ...current,
          generating: false,
          error: message
        }));
        toast.error({ title: "Proposal generation failed", detail: message });
        return;
      }

      const generatedProposal = result.proposal;
      const [proposals, activities] = await Promise.all([
        listProposals(accessToken, { leadId: state.selectedLead.id, limit: 50 }).catch(() => [
          generatedProposal
        ]),
        listLeadActivities(accessToken, state.selectedLead.id).catch(() => state.activities)
      ]);
      const selectedProposal =
        proposals.find((proposal) => proposal.id === generatedProposal.id) ?? generatedProposal;
      const corrections = await listAgentCorrections(accessToken, {
        proposalId: selectedProposal.id,
        limit: 10
      }).catch(() => []);

      setState((current) => ({ ...current, activities }));
      setProposalState((current) => ({
        ...current,
        proposals,
        selectedProposalId: selectedProposal.id,
        corrections,
        correctionSummary: "",
        draftTitle: selectedProposal.title,
        draftContent: selectedProposal.currentVersion?.content ?? "",
        loading: false,
        saving: false,
        generating: false,
        correctionSaving: false,
        error: null,
        sendResult: null
      }));
      toast.success({
        title: "Grounded proposal generated",
        detail: selectedProposal.status.replaceAll("_", " ")
      });
    } catch (error) {
      const message = apiErrorMessage(error, "Grounded proposal could not be generated");
      setProposalState((current) => ({
        ...current,
        generating: false,
        error: message
      }));
      toast.error({ title: "Proposal generation failed", detail: message });
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
      toast.success({ title: "Approved proposal sent" });
    } catch (error) {
      const message = apiErrorMessage(error, "Approved proposal could not be sent");
      setProposalState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Proposal send failed", detail: message });
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
      const requestedTitle =
        meetingState.title.trim().length > 0 && !isGeneratedMeetingTitle(meetingState.title)
          ? meetingState.title.trim()
          : defaultMeetingTitle(state.selectedLead);
      const request = await createMeetingRequest(accessToken, {
        leadId: state.selectedLead.id,
        ownerId: state.selectedLead.ownerId ?? currentUser.id,
        title: requestedTitle,
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
      toast.success({
        title: meetingRequestHasProposedSlots(request)
          ? "Meeting slots requested"
          : request.status === "CONFIRMED"
            ? "Existing confirmed meeting loaded"
            : "Meeting request loaded"
      });
    } catch (error) {
      const message = apiErrorMessage(error, "Meeting slots could not be requested");
      setMeetingState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Meeting request failed", detail: message });
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
      toast.success({ title: "Meeting confirmed" });
    } catch (error) {
      const message = apiErrorMessage(error, "Meeting could not be confirmed");
      setMeetingState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Meeting confirmation failed", detail: message });
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
      if (run.status === "FAILED") {
        toast.error({
          title: "Lead briefing failed",
          detail: run.failureMessage ?? run.failureCode ?? "Briefing generation failed"
        });
      } else {
        toast.success({ title: "Lead briefing generated" });
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Lead briefing could not be generated");
      setBriefingState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Lead briefing failed", detail: message });
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
      if (run.status === "FAILED") {
        toast.error({
          title: "Meeting briefing failed",
          detail: run.failureMessage ?? run.failureCode ?? "Briefing generation failed"
        });
      } else {
        toast.success({ title: "Meeting briefing generated" });
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Meeting briefing could not be generated");
      setBriefingState((current) => ({
        ...current,
        saving: false,
        error: message
      }));
      toast.error({ title: "Meeting briefing failed", detail: message });
    }
  }

  async function markLeadNotificationRead(notificationId: string): Promise<void> {
    try {
      const notification = await markNotificationRead(accessToken, notificationId);
      setState((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item.id === notification.id ? notification : item
        )
      }));
      toast.success({ title: "Notification marked read" });
    } catch (error) {
      toast.error({
        title: "Notification update failed",
        detail: apiErrorMessage(error, "Notification could not be marked read")
      });
    }
  }

  async function acknowledgeLeadNotification(notificationId: string): Promise<void> {
    try {
      const notification = await acknowledgeNotification(accessToken, notificationId);
      setState((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item.id === notification.id ? notification : item
        )
      }));
      toast.success({ title: "Notification acknowledged" });
    } catch (error) {
      toast.error({
        title: "Acknowledgement failed",
        detail: apiErrorMessage(error, "Notification could not be acknowledged")
      });
    }
  }

  const canSyncZoho = currentUser.role === "ADMIN" || currentUser.role === "SALES_MANAGER";
  const isProfile = Boolean(initialLeadId);

  return (
    <section
      className={`crm-workspace phase4a-workspace${isProfile ? " profile-mode" : " list-mode"}`}
      aria-label="CRM workspace"
    >
      {!isProfile ? (
        <div className="workspace-rail">
          <div className="workspace-actions">
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
            {canSyncZoho ? (
              <button
                className="workspace-sync-button"
                disabled={zohoSyncState.syncing || state.loading}
                onClick={() => void syncZohoLeadsContacts()}
                type="button"
              >
                <Icon name="refresh" size={16} />
                {zohoSyncState.syncing ? "Syncing Zoho" : "Sync Zoho"}
              </button>
            ) : null}
          </div>
          <LeadFilters
            filters={filters}
            stages={state.stages}
            users={state.users}
            onChange={applyFilters}
          />
          {zohoSyncState.result !== null || zohoSyncState.error !== null ? (
            <div
              aria-live="polite"
              className={`workspace-sync-status${zohoSyncState.error ? " error" : ""}`}
            >
              {zohoSyncState.error ??
                (zohoSyncState.result ? formatZohoSyncResult(zohoSyncState.result) : null)}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error && state.leadsPage ? (
        <p className="refresh-error" role="alert">
          {state.error}. Showing the last loaded data.
        </p>
      ) : null}
      <div className={`workspace-grid${isProfile ? " profile-grid" : " list-grid"}`}>
        {!isProfile ? (
          <div className="workspace-panel phase4a-list-panel">
            {state.loading ? (
              <StateBlock title="Loading CRM" detail="Fetching real sales records from the API." />
            ) : state.error && !state.leadsPage ? (
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
              <LeadList
                leads={leads}
                selectedLeadId={quickViewOpen ? state.selectedLead?.id : undefined}
                tasks={workspaceTasks}
                onSelect={openQuickView}
              />
            ) : (
              <PipelineBoard groupedLeads={groupedLeads} onSelect={openQuickView} />
            )}
            {state.leadsPage && state.leadsPage.totalPages > 1 ? (
              <nav className="lead-pagination" aria-label="Lead pages">
                <span>
                  Showing {(state.leadsPage.page - 1) * state.leadsPage.pageSize + 1} -{" "}
                  {Math.min(state.leadsPage.page * state.leadsPage.pageSize, state.leadsPage.total)}{" "}
                  of {state.leadsPage.total}
                </span>
                <div>
                  <button
                    disabled={state.leadsPage.page <= 1}
                    onClick={() => void applyFilters({ page: (state.leadsPage?.page ?? 2) - 1 })}
                    type="button"
                  >
                    Previous
                  </button>
                  <strong>{state.leadsPage.page}</strong>
                  <button
                    disabled={state.leadsPage.page >= state.leadsPage.totalPages}
                    onClick={() => void applyFilters({ page: (state.leadsPage?.page ?? 0) + 1 })}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </nav>
            ) : null}
          </div>
        ) : null}

        {isProfile ? (
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
            onHumanReplyInputChange={(humanReplyInput) =>
              setConversationState((current) => ({ ...current, humanReplyInput }))
            }
            onE2ECustomerReplyInputChange={(e2eReplyInput) =>
              setConversationState((current) => ({ ...current, e2eReplyInput }))
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
            onProposalGenerate={generateSelectedProposal}
            onProposalRefresh={() =>
              state.selectedLead ? loadLeadProposals(state.selectedLead.id) : Promise.resolve()
            }
            qualificationState={qualificationState}
            onProposalSave={saveProposalDraft}
            onProposalSelect={selectProposal}
            onProposalSend={sendSelectedProposal}
            onProposalCorrection={recordProposalCorrection}
            onSendProspectMessage={sendProspectMessage}
            onSendHumanReply={sendHumanReply}
            onSubmitE2ECustomerReply={submitE2ECustomerReplyFromConversation}
            onAccelerateFollowUpForE2E={accelerateProductionFollowUpForE2E}
            onRunCallingAttemptNowForE2E={runAiCallNowForE2E}
            onStartFollowUp={startProductionFollowUp}
            onStartConversation={startSimulatorConversation}
            onStartHumanTakeover={startSelectedHumanTakeover}
            onTabChange={changeDetailTab}
            proposalState={proposalState}
            taskState={taskState}
            onCompleteTask={completeLeadTask}
            onBack={() => onRouteChange?.(null)}
          />
        ) : null}
      </div>
      {!isProfile ? (
        <LeadQuickView
          activities={state.activities}
          lead={state.selectedLead}
          qualification={qualificationState.qualification}
          tasks={taskState.tasks}
          tasksLoading={taskState.loading}
          tasksError={taskState.error}
          meetings={meetingState.requests}
          open={quickViewOpen}
          onClose={() => setQuickViewOpen(false)}
          onCompleteTask={completeLeadTask}
          onOpenProfile={() => {
            if (state.selectedLead) onRouteChange?.(state.selectedLead.id, "Overview");
          }}
        />
      ) : null}
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
  const stageOptions = [
    { label: "All stages", value: "" },
    ...stages.map((stage) => ({ label: stage.label, value: stage.id }))
  ];
  const ownerOptions = [
    { label: "All owners", value: "" },
    ...users.map((user) => ({ label: `${user.firstName} ${user.lastName}`, value: user.id }))
  ];
  const sortOptions = [
    { label: "Latest activity", value: "lastActivityAt" },
    { label: "Created date", value: "createdAt" }
  ];
  const statusOptions = [
    { label: "All statuses", value: "" },
    { label: "Open", value: "OPEN" },
    { label: "Nurture", value: "NURTURE" },
    { label: "Won", value: "WON" },
    { label: "Lost", value: "LOST" },
    { label: "Disqualified", value: "DISQUALIFIED" }
  ];

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
      <Select
        ariaLabel="Filter by status"
        onChange={(status) => void onChange({ status })}
        options={statusOptions}
        value={filters.status ?? ""}
      />
      <Select
        ariaLabel="Filter by stage"
        onChange={(stageId) => void onChange({ stageId })}
        options={stageOptions}
        value={filters.stageId ?? ""}
      />
      <Select
        ariaLabel="Filter by owner"
        onChange={(ownerId) => void onChange({ ownerId })}
        options={ownerOptions}
        value={filters.ownerId ?? ""}
      />
      <Select
        ariaLabel="Sort leads"
        onChange={(sort) =>
          void onChange({ sort: sort as LeadListParams["sort"], direction: "desc" })
        }
        options={sortOptions}
        value={filters.sort ?? "lastActivityAt"}
      />
    </form>
  );
}

function LeadList({
  leads,
  selectedLeadId,
  tasks,
  onSelect
}: {
  leads: LeadDto[];
  selectedLeadId?: string;
  tasks: TaskDto[];
  onSelect: (leadId: string) => Promise<void>;
}): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const allSelected = leads.length > 0 && leads.every((lead) => selectedIds.has(lead.id));
  const toggle = (leadId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  return (
    <div className="phase4a-lead-list">
      <header className="lead-list-heading">
        <div>
          <p className="eyebrow">CRM / Leads</p>
          <h2>All Leads</h2>
        </div>
        <div className="lead-list-counts" aria-label="Lead counts">
          <span className="active">
            All <strong>{leads.length}</strong>
          </span>
          <span>
            Open <strong>{leads.filter((lead) => lead.status === "OPEN").length}</strong>
          </span>
          <span>
            Nurture <strong>{leads.filter((lead) => lead.status === "NURTURE").length}</strong>
          </span>
        </div>
      </header>
      {selectedIds.size > 0 ? (
        <div className="lead-selection-bar" role="status">
          <strong>{selectedIds.size} selected</strong>
          <button onClick={() => setSelectedIds(new Set())} type="button">
            Clear selection
          </button>
        </div>
      ) : null}
      <div className="lead-list" role="table" aria-label="Leads list">
        <div className="lead-row lead-row-head" role="row">
          <span>
            <input
              aria-label="Select all leads"
              checked={allSelected}
              onChange={() =>
                setSelectedIds(allSelected ? new Set() : new Set(leads.map((lead) => lead.id)))
              }
              type="checkbox"
            />
          </span>
          <span>Name</span>
          <span>Company</span>
          <span>Owner</span>
          <span>Status</span>
          <span>Deal stage</span>
          <span>Priority</span>
          <span>Score</span>
          <span>Next action</span>
        </div>
        {leads.map((lead) => {
          const priority = leadPriority(tasks.filter((task) => task.leadId === lead.id));
          return (
            <div
              className={`lead-row ${lead.id === selectedLeadId ? "selected" : ""}`}
              key={lead.id}
              role="row"
            >
              <span>
                <input
                  aria-label={`Select ${leadName(lead)}`}
                  checked={selectedIds.has(lead.id)}
                  onChange={() => toggle(lead.id)}
                  type="checkbox"
                />
              </span>
              <button
                className="lead-primary-cell"
                onClick={() => void onSelect(lead.id)}
                type="button"
              >
                <span className="lead-avatar" aria-hidden="true">
                  {lead.contact.firstName.slice(0, 1)}
                  {lead.contact.lastName.slice(0, 1)}
                </span>
                <span>
                  <strong>{leadName(lead)}</strong>
                  <small>{lead.contact.email ?? "No email"}</small>
                </span>
              </button>
              <span>{lead.company.name}</span>
              <span>
                {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
              </span>
              <span>
                <StatusBadge tone="neutral">{lead.status.replaceAll("_", " ")}</StatusBadge>
              </span>
              <span>{lead.stage.label}</span>
              <span>{priority === "NONE" ? "-" : priority}</span>
              <span>
                <strong>{lead.score}</strong>
                <small>{lead.temperature}</small>
              </span>
              <span>{lead.nextAction ?? "No next action"}</span>
            </div>
          );
        })}
      </div>
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
  qualificationState,
  taskState,
  stages,
  users,
  onAssignOwner,
  onChangeStage,
  onConversationChange,
  onConversationInputChange,
  onHumanReplyInputChange,
  onE2ECustomerReplyInputChange,
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
  onProposalGenerate,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onProposalCorrection,
  onSendProspectMessage,
  onSendHumanReply,
  onSubmitE2ECustomerReply,
  onAccelerateFollowUpForE2E,
  onRunCallingAttemptNowForE2E,
  onStartFollowUp,
  onStartConversation,
  onStartHumanTakeover,
  onTabChange,
  onCompleteTask,
  onBack
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
  qualificationState: QualificationState;
  taskState: TaskState;
  stages: PipelineStageDto[];
  users: PublicUser[];
  onAssignOwner: (ownerId: string) => Promise<void>;
  onChangeStage: (stageId: string) => Promise<void>;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onHumanReplyInputChange: (input: string) => void;
  onE2ECustomerReplyInputChange: (input: string) => void;
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
  onProposalGenerate: () => Promise<void>;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onProposalCorrection: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onSendHumanReply: () => Promise<void>;
  onSubmitE2ECustomerReply: () => Promise<void>;
  onAccelerateFollowUpForE2E: (sequenceId: string) => Promise<void>;
  onRunCallingAttemptNowForE2E: () => Promise<void>;
  onStartFollowUp: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
  onTabChange: (tab: DetailTab) => void;
  onCompleteTask: (taskId: string) => Promise<void>;
  onBack: () => void;
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

  const stageOptions = stages.map((stage) => ({ label: stage.label, value: stage.id }));
  const ownerOptions = [
    { label: "Unassigned", value: "" },
    ...users.map((user) => ({ label: `${user.firstName} ${user.lastName}`, value: user.id }))
  ];
  const followUpAction = activeFollowUpLeadAction(conversationState.followUpSequences);
  const nextAction = lead.nextAction ?? followUpAction?.nextAction ?? "No next action";
  const nextActionAt = lead.nextActionAt ?? followUpAction?.nextActionAt ?? null;

  return (
    <main className="lead-detail lead-profile" aria-label="Lead profile">
      <div className="lead-profile-breadcrumb">
        <button onClick={onBack} type="button">
          <ArrowLeft size={16} /> All leads
        </button>
        <span>Lead profile</span>
      </div>
      <header className="detail-hero">
        <span className="lead-avatar profile-avatar" aria-hidden="true">
          {lead.contact.firstName.slice(0, 1)}
          {lead.contact.lastName.slice(0, 1)}
        </span>
        <div className="profile-identity">
          <p className="eyebrow">{lead.source}</p>
          <h2>{leadName(lead)}</h2>
          <p>
            {lead.contact.title ? `${lead.contact.title} at ` : ""}
            {lead.company.name}
          </p>
        </div>
        <div className="profile-quick-actions">
          {lead.contact.email ? (
            <a href={`mailto:${lead.contact.email}`}>
              <Mail size={16} /> Email
            </a>
          ) : null}
          {lead.contact.phone ? (
            <a href={`tel:${lead.contact.phone}`}>
              <Phone size={16} /> Call
            </a>
          ) : null}
        </div>
        <div className="score-orbit" aria-label={`Lead score ${String(lead.score)}`}>
          <span>{lead.score}</span>
          <StatusBadge tone={temperatureTone(lead.temperature)}>{lead.temperature}</StatusBadge>
        </div>
      </header>

      <LeadFactStrip
        lead={lead}
        qualification={qualificationState.qualification}
        tasks={taskState.tasks}
      />

      <div className="detail-controls">
        <label>
          <span>Stage</span>
          <Select
            ariaLabel="Change lead stage"
            onChange={(stageId) => void onChangeStage(stageId)}
            options={stageOptions}
            value={lead.stageId}
          />
        </label>
        <label>
          <span>Owner</span>
          <Select
            ariaLabel="Assign owner"
            onChange={(ownerId) => void onAssignOwner(ownerId)}
            options={ownerOptions}
            value={lead.ownerId ?? ""}
          />
        </label>
      </div>

      <div className="detail-metrics">
        <span>
          <small>Estimated value</small>
          <strong>{formatMoney(lead.estimatedValue, lead.currency)}</strong>
        </span>
        <span>
          <small>Last activity</small>
          <strong>{formatDate(lead.lastActivityAt)}</strong>
        </span>
        <span>
          <small>Next action</small>
          <strong>{nextAction}</strong>
        </span>
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
            {tab === "Activities" ? "Sessions" : tab}
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
        nextAction={nextAction}
        nextActionAt={nextActionAt}
        proposalState={proposalState}
        qualificationState={qualificationState}
        taskState={taskState}
        tab={activeTab}
        onConversationChange={onConversationChange}
        onConversationInputChange={onConversationInputChange}
        onHumanReplyInputChange={onHumanReplyInputChange}
        onE2ECustomerReplyInputChange={onE2ECustomerReplyInputChange}
        onModeChange={onModeChange}
        onGenerateLeadBriefing={onGenerateLeadBriefing}
        onGenerateMeetingBriefing={onGenerateMeetingBriefing}
        onMeetingConfirm={onMeetingConfirm}
        onMeetingDraftChange={onMeetingDraftChange}
        onMeetingRefresh={onMeetingRefresh}
        onMeetingRequest={onMeetingRequest}
        onProposalApprove={onProposalApprove}
        onProposalDraftChange={onProposalDraftChange}
        onProposalGenerate={onProposalGenerate}
        onProposalRefresh={onProposalRefresh}
        onProposalSave={onProposalSave}
        onProposalSelect={onProposalSelect}
        onProposalSend={onProposalSend}
        onProposalCorrection={onProposalCorrection}
        onSendProspectMessage={onSendProspectMessage}
        onSendHumanReply={onSendHumanReply}
        onSubmitE2ECustomerReply={onSubmitE2ECustomerReply}
        onAccelerateFollowUpForE2E={onAccelerateFollowUpForE2E}
        onRunCallingAttemptNowForE2E={onRunCallingAttemptNowForE2E}
        onStartFollowUp={onStartFollowUp}
        onStartConversation={onStartConversation}
        onStartHumanTakeover={onStartHumanTakeover}
        onCompleteTask={onCompleteTask}
      />
    </main>
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
  nextAction,
  nextActionAt,
  proposalState,
  qualificationState,
  taskState,
  tab,
  onConversationChange,
  onConversationInputChange,
  onHumanReplyInputChange,
  onE2ECustomerReplyInputChange,
  onGenerateLeadBriefing,
  onGenerateMeetingBriefing,
  onModeChange,
  onMeetingConfirm,
  onMeetingDraftChange,
  onMeetingRefresh,
  onMeetingRequest,
  onProposalApprove,
  onProposalDraftChange,
  onProposalGenerate,
  onProposalRefresh,
  onProposalSave,
  onProposalSelect,
  onProposalSend,
  onProposalCorrection,
  onSendProspectMessage,
  onSendHumanReply,
  onSubmitE2ECustomerReply,
  onAccelerateFollowUpForE2E,
  onRunCallingAttemptNowForE2E,
  onStartFollowUp,
  onStartConversation,
  onStartHumanTakeover,
  onCompleteTask
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto;
  briefingState: BriefingState;
  meetingState: MeetingState;
  nextAction: string;
  nextActionAt: string | null;
  proposalState: ProposalState;
  qualificationState: QualificationState;
  taskState: TaskState;
  tab: DetailTab;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onHumanReplyInputChange: (input: string) => void;
  onE2ECustomerReplyInputChange: (input: string) => void;
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
  onProposalGenerate: () => Promise<void>;
  onProposalRefresh: () => Promise<void>;
  onProposalSave: () => Promise<void>;
  onProposalSelect: (proposalId: string) => void;
  onProposalSend: () => Promise<void>;
  onProposalCorrection: () => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onSendHumanReply: () => Promise<void>;
  onSubmitE2ECustomerReply: () => Promise<void>;
  onAccelerateFollowUpForE2E: (sequenceId: string) => Promise<void>;
  onRunCallingAttemptNowForE2E: () => Promise<void>;
  onStartFollowUp: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
  onCompleteTask: (taskId: string) => Promise<void>;
}): React.JSX.Element {
  if (tab === "Conversation") {
    return (
      <ConversationSimulator
        activities={activities}
        conversationState={conversationState}
        currentUser={currentUser}
        lead={lead}
        qualification={qualificationState.qualification}
        onConversationChange={onConversationChange}
        onConversationInputChange={onConversationInputChange}
        onHumanReplyInputChange={onHumanReplyInputChange}
        onE2ECustomerReplyInputChange={onE2ECustomerReplyInputChange}
        onModeChange={onModeChange}
        onSendProspectMessage={onSendProspectMessage}
        onSendHumanReply={onSendHumanReply}
        onSubmitE2ECustomerReply={onSubmitE2ECustomerReply}
        onAccelerateFollowUpForE2E={onAccelerateFollowUpForE2E}
        onRunCallingAttemptNowForE2E={onRunCallingAttemptNowForE2E}
        onStartFollowUp={onStartFollowUp}
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
        onGenerate={onProposalGenerate}
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
      <div className="tab-panel tab-panel-structured">
        <TabSection
          eyebrow="Activities"
          title="Latest activity"
          meta={`${String(activities.length)} records`}
        >
          {activities.length === 0 ? (
            <StateBlock title="No activities yet" />
          ) : (
            <LeadTimeline activities={activities} />
          )}
        </TabSection>
      </div>
    );
  }

  if (tab === "Tasks") {
    return (
      <div className="tab-panel tab-panel-structured">
        <TabSection
          eyebrow="Tasks"
          title="Lead work"
          meta={`${String(taskState.tasks.length)} tasks`}
        >
          <LeadTaskList
            tasks={taskState.tasks}
            loading={taskState.loading}
            error={taskState.error}
            onComplete={onCompleteTask}
          />
        </TabSection>
      </div>
    );
  }

  if (tab === "Deal") {
    return (
      <div className="tab-panel tab-panel-structured">
        <TabSection eyebrow="Deal" title="Pipeline context" meta={lead.stage.label}>
          <div className="tab-data-grid">
            <TabData
              label="Estimated value"
              value={formatMoney(lead.estimatedValue, lead.currency)}
            />
            <TabData label="Stage" value={lead.stage.label} />
            <TabData label="Probability" value={`${String(lead.stage.probability)}%`} />
            <TabData label="Status" value={lead.status.replaceAll("_", " ")} />
            <TabData label="Next action" value={nextAction} />
            <TabData label="Next action at" value={formatDate(nextActionAt)} />
          </div>
        </TabSection>
      </div>
    );
  }

  if (tab === "Overview") {
    return (
      <div className="tab-panel tab-panel-structured">
        <TabSection
          eyebrow="Overview"
          title="Lead snapshot"
          meta={lead.status.replaceAll("_", " ")}
        >
          <div className="tab-data-grid">
            <TabData label="Contact" value={`${lead.contact.firstName} ${lead.contact.lastName}`} />
            <TabData
              label="Requirement"
              value={lead.requirement ?? "Requirement not captured yet"}
            />
            <TabData
              label="Service interest"
              value={lead.serviceInterest ?? "Service interest not captured yet"}
            />
            <TabData label="Source" value={lead.source} />
            <TabData
              label="Owner"
              value={lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
            />
            <TabData label="Created" value={formatDate(lead.createdAt)} />
          </div>
        </TabSection>
      </div>
    );
  }

  return (
    <div className="tab-panel tab-panel-structured">
      <TabSection eyebrow="Qualification" title="Qualification signals" meta={lead.temperature}>
        {qualificationState.error ? <p className="form-error">{qualificationState.error}</p> : null}
        <div className="tab-data-grid">
          <TabData
            label="Need"
            value={qualificationValue(
              qualificationState.qualification,
              "need",
              lead.requirement,
              "Need unknown"
            )}
          />
          <TabData
            label="Requirement"
            value={qualificationValue(
              qualificationState.qualification,
              "requirement",
              lead.serviceInterest,
              "Requirement unknown"
            )}
          />
          <TabData label="Budget" value={budgetValue(qualificationState.qualification)} />
          <TabData
            label="Authority"
            value={qualificationValue(
              qualificationState.qualification,
              "authority",
              null,
              "Authority unknown"
            )}
          />
          <TabData
            label="Timeline"
            value={qualificationValue(
              qualificationState.qualification,
              "timeline",
              null,
              "Timeline unknown"
            )}
          />
          <TabData
            label="Decision maker"
            value={decisionMakerValue(qualificationState.qualification)}
          />
          <TabData
            label="Business fit"
            value={qualificationValue(
              qualificationState.qualification,
              "businessFit",
              null,
              "Business fit unknown"
            )}
          />
          <TabData
            label="Urgency"
            value={qualificationValue(
              qualificationState.qualification,
              "urgency",
              null,
              "Urgency unknown"
            )}
          />
          <TabData label="Score" value={String(lead.score)} />
          <TabData label="Temperature" value={lead.temperature} />
          <TabData label="Stage" value={lead.stage.label} />
          <TabData label="Last activity" value={formatDate(lead.lastActivityAt)} />
        </div>
        {qualificationState.qualification?.evidence.length ? (
          <div className="qualification-evidence" aria-label="Qualification evidence">
            <strong>Evidence</strong>
            {qualificationState.qualification.evidence.slice(0, 3).map((item) => (
              <span key={item.id}>{item.quote}</span>
            ))}
          </div>
        ) : null}
      </TabSection>
    </div>
  );
}

function TabSection({
  children,
  eyebrow,
  meta,
  title
}: {
  children: React.ReactNode;
  eyebrow: string;
  meta?: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className="tab-section">
      <header className="tab-section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        {meta ? <StatusBadge tone="neutral">{meta}</StatusBadge> : null}
      </header>
      {children}
    </section>
  );
}

function TabData({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="tab-data-item">
      <span>{label}</span>
      <strong>{value}</strong>
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
  const generateAction = (
    <button
      disabled={briefingState.saving || !lead.id}
      onClick={() => void onGenerate()}
      type="button"
    >
      <Icon name="sparkles" size={16} />
      Generate briefing
    </button>
  );

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
        {briefingState.error ? <p className="form-error">{briefingState.error}</p> : null}
      </section>
      {briefingState.loading ? (
        <StateBlock title="Loading briefings" />
      ) : latest ? (
        <>
          <BriefingCard run={latest} />
          <div className="ai-insights-actions">{generateAction}</div>
        </>
      ) : (
        <>
          <div className="ai-insights-actions">{generateAction}</div>
          <StateBlock
            title="No lead briefing yet"
            detail="Generate one from real persisted evidence."
          />
        </>
      )}
    </div>
  );
}

function meetingDatePart(value: string): string {
  return value.split("T")[0] ?? "";
}

function meetingTimePart(value: string): string {
  return value.split("T")[1]?.slice(0, 5) ?? "09:00";
}

function mergeMeetingDateTime(value: string, patch: { date?: string; time?: string }): string {
  const fallback = nextBusinessWindow().windowStart;
  const date = patch.date ?? (meetingDatePart(value) || meetingDatePart(fallback));
  const time = patch.time ?? meetingTimePart(value);
  return `${date}T${time}`;
}

function meetingRequestHasProposedSlots(request: MeetingRequestDto): boolean {
  return (
    request.status === "CONFIRMATION_REQUIRED" &&
    request.slots.some((slot) => slot.status === "PROPOSED")
  );
}

function selectCurrentMeetingRequest(requests: MeetingRequestDto[]): MeetingRequestDto | null {
  return (
    requests.find(meetingRequestHasProposedSlots) ??
    requests.find((request) => request.status === "PROVIDER_PENDING") ??
    requests.find((request) => request.status === "CONFIRMED") ??
    requests.find((request) => request.status === "ATTENTION_REQUIRED") ??
    requests[0] ??
    null
  );
}

function formatSlotRange(slot: MeetingRequestDto["slots"][number]): string {
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: slot.timeZone
  }).format(startsAt);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: slot.timeZone
  });
  return `${date}, ${time.format(startsAt)}-${time.format(endsAt)} ${slot.timeZone}`;
}

function defaultMeetingTitle(lead: LeadDto): string {
  const contactName = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
  return `Meeting with ${contactName} from ${lead.company.name}`;
}

function isGeneratedMeetingTitle(value: string): boolean {
  return /^Meeting with .+/i.test(value.trim());
}

function confirmedMeetingSlot(
  request: MeetingRequestDto
): MeetingRequestDto["slots"][number] | null {
  return (
    request.slots.find((slot) => slot.id === request.selectedSlotId) ??
    request.slots.find((slot) => slot.status === "SELECTED") ??
    null
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
  const currentRequest = selectCurrentMeetingRequest(meetingState.requests);
  const historicalRequests = currentRequest
    ? meetingState.requests.filter((request) => request.id !== currentRequest.id)
    : [];
  const currentHasSlots = currentRequest ? meetingRequestHasProposedSlots(currentRequest) : false;
  const canRequest =
    meetingState.windowStart.trim().length > 0 &&
    meetingState.windowEnd.trim().length > 0 &&
    !currentHasSlots;

  const renderRequestCard = (request: MeetingRequestDto, options?: { historical?: boolean }) => {
    const briefing = briefingState.meetingBriefings.find(
      (item) => item.meetingRequestId === request.id
    );
    const proposedSlots = request.slots.filter((slot) => slot.status === "PROPOSED");
    const visibleSlots = request.slots.filter((slot) => slot.status !== "PROPOSED");
    const confirmedSlot = confirmedMeetingSlot(request);
    return (
      <article
        className={`proposal-list-item meeting-request-card${options?.historical ? " historical" : ""}`}
        key={request.id}
      >
        <div className="meeting-request-summary">
          <strong>{request.title}</strong>
          <span>{request.status.replaceAll("_", " ")}</span>
          <small>
            Provider {request.providerSyncStatus.replaceAll("_", " ")} / Zoho{" "}
            {request.zohoSyncStatus.replaceAll("_", " ")}
          </small>
          {request.providerLastError ? <small>{request.providerLastError}</small> : null}
          {request.partyNotificationNote ? <small>{request.partyNotificationNote}</small> : null}
        </div>
        {request.status === "CONFIRMED" ? (
          <div
            className="meeting-provider-evidence"
            aria-label="Confirmed meeting provider evidence"
          >
            <span>
              <strong>Confirmed time</strong>
              {confirmedSlot ? formatSlotRange(confirmedSlot) : formatDate(request.confirmedAt)}
            </span>
            <span>
              <strong>Provider</strong>
              Google Calendar
              {request.providerCalendarId ? ` / ${request.providerCalendarId}` : ""}
            </span>
            <span>
              <strong>Organizer</strong>
              {request.providerOrganizerEmail ?? "Verified organizer not stored yet"}
            </span>
            <span>
              <strong>Event ID</strong>
              {request.providerMeetingId ?? "Not available"}
            </span>
            {request.providerMeetingUrl ? (
              <a href={request.providerMeetingUrl} rel="noreferrer" target="_blank">
                Open in Google Calendar
              </a>
            ) : null}
          </div>
        ) : null}
        {briefing ? <BriefingCard run={briefing} /> : null}
        {proposedSlots.length > 0 ? (
          <div className="meeting-slot-grid" aria-label="Available meeting slots">
            {proposedSlots.map((slot) => (
              <button
                disabled={meetingState.saving || request.status !== "CONFIRMATION_REQUIRED"}
                key={slot.id}
                onClick={() => void onConfirm(request.id, slot.id)}
                type="button"
              >
                <Icon name="check" size={15} />
                Confirm {formatSlotRange(slot)}
              </button>
            ))}
          </div>
        ) : visibleSlots.length > 0 ? (
          <div className="meeting-slot-list" aria-label="Persisted meeting slots">
            {visibleSlots.map((slot) => (
              <span className={slot.status.toLowerCase()} key={slot.id}>
                <strong>{slot.status.replaceAll("_", " ")}</strong>
                {formatSlotRange(slot)}
              </span>
            ))}
          </div>
        ) : null}
        <button
          className="secondary-action"
          disabled={briefingState.saving}
          onClick={() => void onGenerateBriefing(request.id)}
          type="button"
        >
          <Icon name="sparkles" size={15} />
          Briefing
        </button>
      </article>
    );
  };

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
            placeholder={defaultMeetingTitle(lead)}
            value={meetingState.title}
          />
        </label>
        <div className="meeting-time-grid">
          <label className="proposal-field">
            Start date
            <input
              disabled={meetingState.saving}
              onChange={(event) =>
                onDraftChange({
                  windowStart: mergeMeetingDateTime(meetingState.windowStart, {
                    date: event.target.value
                  })
                })
              }
              type="date"
              value={meetingDatePart(meetingState.windowStart)}
            />
          </label>
          <label className="proposal-field">
            Start time
            <input
              disabled={meetingState.saving}
              onChange={(event) =>
                onDraftChange({
                  windowStart: mergeMeetingDateTime(meetingState.windowStart, {
                    time: event.target.value
                  })
                })
              }
              step={900}
              type="time"
              value={meetingTimePart(meetingState.windowStart)}
            />
          </label>
          <label className="proposal-field">
            End date
            <input
              disabled={meetingState.saving}
              onChange={(event) =>
                onDraftChange({
                  windowEnd: mergeMeetingDateTime(meetingState.windowEnd, {
                    date: event.target.value
                  })
                })
              }
              type="date"
              value={meetingDatePart(meetingState.windowEnd)}
            />
          </label>
          <label className="proposal-field">
            End time
            <input
              disabled={meetingState.saving}
              onChange={(event) =>
                onDraftChange({
                  windowEnd: mergeMeetingDateTime(meetingState.windowEnd, {
                    time: event.target.value
                  })
                })
              }
              step={900}
              type="time"
              value={meetingTimePart(meetingState.windowEnd)}
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
            {currentHasSlots ? "Slots available" : "Request slots"}
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
        <div className="meeting-request-stack" aria-label="Meeting requests">
          {currentRequest ? renderRequestCard(currentRequest) : null}
          {historicalRequests.length > 0 ? (
            <details className="meeting-history">
              <summary>Historical meeting request evidence ({historicalRequests.length})</summary>
              <div className="proposal-list">
                {historicalRequests.map((request) =>
                  renderRequestCard(request, { historical: true })
                )}
              </div>
            </details>
          ) : null}
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
  onGenerate,
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
  onGenerate: () => Promise<void>;
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
  const hasMultipleProposals = proposalState.proposals.length > 1;

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
        <section className="proposal-empty-state" aria-label="Proposal generation">
          <strong>No proposals</strong>
          <span>
            Generate a grounded draft from persisted lead, qualification, conversation and approved
            knowledge evidence.
          </span>
          <div className="proposal-actions">
            <button
              aria-label="Generate grounded proposal"
              disabled={proposalState.generating}
              onClick={() => void onGenerate()}
              type="button"
            >
              <Icon name="sparkles" size={16} />
              {proposalState.generating ? "Generating proposal" : "Generate grounded proposal"}
            </button>
            <button
              disabled={proposalState.generating}
              onClick={() => void onRefresh()}
              type="button"
            >
              <Icon name="refresh" size={16} />
              Refresh
            </button>
          </div>
        </section>
        {proposalState.error ? <p className="form-error">{proposalState.error}</p> : null}
      </div>
    );
  }

  return (
    <div className="tab-panel proposal-review">
      {hasMultipleProposals ? (
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
      ) : null}

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
                      {correction.agentModule} - {formatDate(correction.createdAt)}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No correction evidence recorded for this proposal.</p>
            )}
          </section>

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

          <div className="proposal-actions proposal-primary-actions">
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
        </section>
      ) : (
        <StateBlock title="Select a proposal" />
      )}
    </div>
  );
}

function nextFollowUpAttempt(sequence: FollowUpSequenceDto | null) {
  if (!sequence) {
    return null;
  }
  return (
    sequence.attempts.find((attempt) => ["SCHEDULED", "SENDING"].includes(attempt.status)) ?? null
  );
}

function activeFollowUpLeadAction(sequences: FollowUpSequenceDto[]): {
  nextAction: string;
  nextActionAt: string;
} | null {
  const sequence = sequences.find((item) => item.status === "ACTIVE") ?? null;
  const attempt = nextFollowUpAttempt(sequence);
  if (!attempt) {
    return null;
  }

  return {
    nextAction:
      attempt.stepIndex === 0
        ? "Send first follow-up email"
        : `Send follow-up email ${String(attempt.stepIndex + 1)}`,
    nextActionAt: attempt.scheduledAt
  };
}

function formatFollowUpNextAction(sequence: FollowUpSequenceDto | null): string {
  if (!sequence) {
    return "No follow-up automation has been started for this lead.";
  }

  if (sequence.status === "ATTENTION_REQUIRED") {
    return (
      sequence.lastErrorMessage ?? "Attention required before follow-up automation can continue."
    );
  }

  if (sequence.status === "STOPPED") {
    return sequence.stopReason ?? "Follow-up automation is stopped.";
  }

  if (sequence.status === "COMPLETED") {
    return "No next action";
  }

  const attempt = nextFollowUpAttempt(sequence);
  if (!attempt) {
    return "No scheduled follow-up attempts are pending.";
  }

  return `${attempt.kind.replaceAll("_", " ")} ${attempt.status.toLowerCase()} for ${formatDate(
    attempt.scheduledAt
  )}`;
}

function ConversationSimulator({
  activities,
  conversationState,
  currentUser,
  lead,
  qualification,
  onConversationChange,
  onConversationInputChange,
  onHumanReplyInputChange,
  onE2ECustomerReplyInputChange,
  onModeChange,
  onSendProspectMessage,
  onSendHumanReply,
  onSubmitE2ECustomerReply,
  onAccelerateFollowUpForE2E,
  onRunCallingAttemptNowForE2E,
  onStartFollowUp,
  onStartConversation,
  onStartHumanTakeover
}: {
  activities: ActivityDto[];
  conversationState: ConversationState;
  currentUser: PublicUser;
  lead: LeadDto;
  qualification: LeadQualificationDto | null;
  onConversationChange: (conversationId: string) => Promise<void>;
  onConversationInputChange: (input: string) => void;
  onHumanReplyInputChange: (input: string) => void;
  onE2ECustomerReplyInputChange: (input: string) => void;
  onModeChange: (mode: ConversationModeName) => Promise<void>;
  onSendProspectMessage: () => Promise<void>;
  onSendHumanReply: () => Promise<void>;
  onSubmitE2ECustomerReply: () => Promise<void>;
  onAccelerateFollowUpForE2E: (sequenceId: string) => Promise<void>;
  onRunCallingAttemptNowForE2E: () => Promise<void>;
  onStartFollowUp: () => Promise<void>;
  onStartConversation: () => Promise<void>;
  onStartHumanTakeover: () => Promise<void>;
}): React.JSX.Element {
  const selectedConversation = conversationState.selectedConversation;
  const isHumanConversation = selectedConversation?.mode === "HUMAN";
  const isEmailConversation = selectedConversation?.channel === "EMAIL";
  const latestFollowUp = conversationState.followUpSequences[0] ?? null;
  const nextAttempt = nextFollowUpAttempt(latestFollowUp);
  const canSubmitE2ECustomerReply = isE2ELocalUi() && currentUser.role === "ADMIN";
  const e2eAcceleratableSequenceId =
    isE2ELocalUi() &&
    currentUser.role === "ADMIN" &&
    latestFollowUp?.status === "ACTIVE" &&
    latestFollowUp.e2eAccelerationEligible &&
    latestFollowUp.cadenceMode !== "E2E_ACCELERATED_MINUTES"
      ? latestFollowUp.id
      : null;
  const messageActivities = activities
    .filter((activity) => activity.type === "MESSAGE_RECEIVED" || activity.type === "MESSAGE_SENT")
    .slice(0, 4);
  const e2eCustomerReplyPanel = canSubmitE2ECustomerReply ? (
    <section className="e2e-customer-reply-panel" aria-label="E2E Customer Reply">
      <header>
        <div>
          <p className="eyebrow">E2E Customer Reply</p>
          <h3>Signed inbound email test</h3>
        </div>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmitE2ECustomerReply();
        }}
      >
        <textarea
          aria-label="E2E Customer Reply"
          onChange={(event) => onE2ECustomerReplyInputChange(event.target.value)}
          placeholder="Customer reply received by email"
          rows={3}
          value={conversationState.e2eReplyInput}
        />
        <button
          disabled={conversationState.saving || conversationState.e2eReplyInput.trim().length === 0}
          type="submit"
        >
          <Icon name="send" size={16} />
          Submit inbound reply
        </button>
      </form>
    </section>
  ) : null;

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
        <section className="production-outreach-panel" aria-label="Production outreach">
          <header>
            <div>
              <p className="eyebrow">Production outreach</p>
              <h3>Follow-up automation</h3>
            </div>
            {latestFollowUp ? (
              <StatusBadge tone={latestFollowUp.status === "ATTENTION_REQUIRED" ? "warm" : "won"}>
                {latestFollowUp.status.replaceAll("_", " ")}
              </StatusBadge>
            ) : null}
          </header>
          <p>{formatFollowUpNextAction(latestFollowUp)}</p>
          <div className="proposal-actions">
            <button
              disabled={
                conversationState.saving ||
                latestFollowUp?.status === "ACTIVE" ||
                isHumanConversation
              }
              onClick={() => void onStartFollowUp()}
              type="button"
            >
              <Icon name="send" size={16} />
              {conversationState.saving ? "Starting automation" : "Start follow-up automation"}
            </button>
            {e2eAcceleratableSequenceId ? (
              <button
                disabled={conversationState.saving || isHumanConversation}
                onClick={() => void onAccelerateFollowUpForE2E(e2eAcceleratableSequenceId)}
                type="button"
              >
                <Icon name="sparkles" size={16} />
                Accelerate E2E
              </button>
            ) : null}
          </div>
        </section>
        {e2eCustomerReplyPanel}
        <div className="simulator-empty internal-simulator">
          <p className="eyebrow">Internal simulator</p>
          <StateBlock
            title="No simulator conversation"
            detail="Use production follow-up automation for real salesperson testing."
            action={
              <button
                disabled={conversationState.saving}
                onClick={() => void onStartConversation()}
                type="button"
              >
                <Icon name="sparkles" size={16} />
                Start internal simulator
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
      <section className="production-outreach-panel" aria-label="Production outreach">
        <header>
          <div>
            <p className="eyebrow">Production outreach</p>
            <h3>Follow-up automation</h3>
          </div>
          {latestFollowUp ? (
            <StatusBadge tone={latestFollowUp.status === "ATTENTION_REQUIRED" ? "warm" : "won"}>
              {latestFollowUp.status.replaceAll("_", " ")}
            </StatusBadge>
          ) : null}
        </header>
        <p>{formatFollowUpNextAction(latestFollowUp)}</p>
        {isHumanConversation ? (
          <p className="muted-copy">
            Automation is paused while the assigned salesperson handles this conversation.
          </p>
        ) : null}
        {nextAttempt ? (
          <div className="automation-grid">
            <span>
              <strong>Next action</strong>
              {nextAttempt.kind.replaceAll("_", " ")}
            </span>
            <span>
              <strong>Scheduled</strong>
              {formatDate(nextAttempt.scheduledAt)}
            </span>
            <span>
              <strong>Attempt status</strong>
              {nextAttempt.status.replaceAll("_", " ")}
            </span>
          </div>
        ) : null}
        <div className="proposal-actions">
          {canSubmitE2ECustomerReply ? (
            <button
              disabled={conversationState.saving || isHumanConversation}
              onClick={() => void onRunCallingAttemptNowForE2E()}
              type="button"
            >
              <Icon name="send" size={16} />
              Run AI call now (E2E)
            </button>
          ) : null}
          <button
            disabled={
              conversationState.saving || latestFollowUp?.status === "ACTIVE" || isHumanConversation
            }
            onClick={() => void onStartFollowUp()}
            type="button"
          >
            <Icon name="send" size={16} />
            {latestFollowUp ? "Refresh/start idempotently" : "Start follow-up automation"}
          </button>
          {e2eAcceleratableSequenceId ? (
            <button
              disabled={conversationState.saving || isHumanConversation}
              onClick={() => void onAccelerateFollowUpForE2E(e2eAcceleratableSequenceId)}
              type="button"
            >
              <Icon name="sparkles" size={16} />
              Accelerate E2E
            </button>
          ) : null}
        </div>
      </section>
      {e2eCustomerReplyPanel}

      <p className="eyebrow">Internal simulator</p>
      <div className="simulator-toolbar">
        <Select
          ariaLabel="Select conversation"
          onChange={(conversationId) => void onConversationChange(conversationId)}
          options={conversationState.conversations.map((conversation) => ({
            label: `${conversation.channel} - ${formatDate(conversation.lastMessageAt)}`,
            value: conversation.id
          }))}
          value={selectedConversation.id}
        />
        <Select
          ariaLabel="AI mode"
          onChange={(mode) => void onModeChange(mode as ConversationModeName)}
          options={CONVERSATION_MODES.map((mode) => ({
            label: mode.replaceAll("_", " "),
            value: mode
          }))}
          value={selectedConversation.mode}
        />
        {!isHumanConversation ? (
          <button
            disabled={conversationState.saving}
            onClick={() => void onStartHumanTakeover()}
            type="button"
          >
            <Icon name="users" size={16} />
            Take over
          </button>
        ) : null}
      </div>

      {conversationState.error ? <p className="form-error">{conversationState.error}</p> : null}
      {conversationState.takeoverBriefing ? (
        <HumanTakeoverBriefing briefing={conversationState.takeoverBriefing} />
      ) : null}

      {isHumanConversation && isEmailConversation ? (
        <section className="human-reply-panel" aria-label="Human reply">
          <header>
            <div>
              <p className="eyebrow">Human reply</p>
              <h3>Reply to customer</h3>
            </div>
            <StatusBadge tone="warm">HUMAN</StatusBadge>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onSendHumanReply();
            }}
          >
            <textarea
              aria-label="Human reply"
              onChange={(event) => onHumanReplyInputChange(event.target.value)}
              placeholder="Write the salesperson reply"
              rows={4}
              value={conversationState.humanReplyInput}
            />
            <button
              disabled={
                conversationState.saving || conversationState.humanReplyInput.trim().length === 0
              }
              type="submit"
            >
              <Icon name="send" size={16} />
              Send human reply
            </button>
          </form>
        </section>
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
            <span>
              {qualificationValue(qualification, "need", lead.requirement, "Unknown requirement")}
            </span>
            <span>
              {qualificationValue(
                qualification,
                "requirement",
                lead.serviceInterest,
                "Unknown service interest"
              )}
            </span>
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
