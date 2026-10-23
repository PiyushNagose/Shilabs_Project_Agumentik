import type React from "react";
import { formatDateTime } from "../../utils/date-time.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONVERSATION_MODES,
  type ActivityDto,
  type AgentCorrectionDto,
  type BriefingRunDto,
  type CompanyDto,
  type ContactDto,
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
import { ArrowLeft, Copy, Mail, Pencil, Phone, Plus } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { useToast } from "../../components/ToastProvider.js";
import { Button, Modal, Select } from "../../components/ui/index.js";
import {
  accelerateFollowUpSequenceForE2E,
  assignLead,
  apiErrorMessage,
  cancelMeetingRequest,
  appendConversationMessage,
  acknowledgeNotification,
  approveProposal,
  confirmMeetingRequest,
  createProposalAgentCorrection,
  completeTask,
  createCompany,
  createContact,
  createConversation,
  createLead,
  createMeetingRequest,
  generateLeadBriefing,
  generateMeetingBriefing,
  generateProposal,
  getLead,
  getHumanTakeoverBriefing,
  getLeadQualification,
  listBriefings,
  listCompanies,
  listContacts,
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
  sendHumanWhatsAppConversationReply,
  runCallingAttemptNowForE2E,
  startFollowUpSequence,
  startHumanTakeover,
  syncZohoLeadContacts,
  submitE2ECustomerReply,
  updateConversationMode,
  updateLeadDetails,
  updateLeadStage,
  updateProposalDraft,
  type LeadListParams
} from "../../services/api-client.js";
import { useRealtime, type RealtimeUpdateEvent } from "../realtime/RealtimeProvider.js";
import { isWorkspaceAdmin, isWorkspaceManager } from "../auth/workspace-access.js";
import { LeadIntelligencePanel } from "../intelligence/LeadIntelligencePanel.js";
import { MeetingLifecycleActions } from "./MeetingLifecycleActions.js";
import { ConversationAttachment } from "./ConversationAttachment.js";
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

function canSimulateCustomerReply(): boolean {
  return (
    isE2ELocalUi() ||
    (import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname))
  );
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
  meetingMode: "VIDEO" | "PHONE" | "IN_PERSON";
  location: string;
  reminderMinutes: number;
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
    meetingMode: "VIDEO",
    location: "",
    reminderMinutes: 30,
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

function NewLeadForm({
  accessToken,
  currentUser,
  users,
  onCreated
}: {
  accessToken: string;
  currentUser: PublicUser;
  users: PublicUser[];
  onCreated: (lead: LeadDto) => Promise<void>;
}): React.JSX.Element {
  const newRecordValue = "__new__";
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [companyId, setCompanyId] = useState(newRecordValue);
  const [contactId, setContactId] = useState(newRecordValue);
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsappId, setWhatsappId] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("EMAIL");
  const [source, setSource] = useState("Website");
  const [leadType, setLeadType] = useState("");
  const [country, setCountry] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [campaign, setCampaign] = useState("");
  const [requirement, setRequirement] = useState("");
  const [serviceInterest, setServiceInterest] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [ownerId, setOwnerId] = useState(currentUser.id);
  const [nextAction, setNextAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRelationships, setLoadingRelationships] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingRelationships(true);
    void Promise.all([listCompanies(accessToken), listContacts(accessToken)])
      .then(([companyItems, contactItems]) => {
        if (!active) return;
        setCompanies(companyItems);
        setContacts(contactItems);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(apiErrorMessage(loadError, "Companies and contacts could not be loaded."));
        }
      })
      .finally(() => {
        if (active) setLoadingRelationships(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  const companyContacts = contacts.filter((contact) => contact.companyId === companyId);
  const creatingCompany = companyId === newRecordValue;
  const creatingContact = creatingCompany || contactId === newRecordValue;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (creatingContact && !email.trim() && !phone.trim() && !whatsappId.trim()) {
        setError("Provide an email address, phone number or WhatsApp number for the new contact.");
        return;
      }
      if (creatingContact && preferredChannel === "WHATSAPP" && !whatsappId.trim()) {
        setError("Provide a WhatsApp number for the preferred channel.");
        return;
      }
      const resolvedCompanyId = creatingCompany
        ? (
            await createCompany(accessToken, {
              name: companyName.trim(),
              website: website.trim() || null
            })
          ).id
        : companyId;
      const resolvedContactId = creatingContact
        ? (
            await createContact(accessToken, {
              companyId: resolvedCompanyId,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              title: title.trim() || null,
              email: email.trim() || null,
              phone: phone.trim() || null,
              whatsappId: whatsappId.trim() || null,
              source,
              preferredChannel
            })
          ).id
        : contactId;
      const lead = await createLead(accessToken, {
        companyId: resolvedCompanyId,
        contactId: resolvedContactId,
        ownerId: ownerId || null,
        source,
        leadType: leadType.trim() || null,
        country: country.trim() || null,
        priority,
        campaign: campaign.trim() || null,
        requirement: requirement || null,
        serviceInterest: serviceInterest || null,
        estimatedValue: estimatedValue || null,
        currency: "INR",
        nextAction: nextAction || null
      });
      await onCreated(lead);
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The lead could not be created"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="lead-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="lead-create-form-grid">
        <label className="lead-create-wide">
          Company
          <Select
            ariaLabel="Lead company"
            onChange={(value) => {
              setCompanyId(value);
              setContactId(newRecordValue);
            }}
            options={[
              { value: newRecordValue, label: "Create new company" },
              ...companies.map((company) => ({ value: company.id, label: company.name }))
            ]}
            value={companyId}
          />
        </label>
        {creatingCompany ? (
          <>
            <label>
              Company name
              <input
                autoFocus
                maxLength={160}
                onChange={(event) => setCompanyName(event.target.value)}
                required
                value={companyName}
              />
            </label>
            <label>
              Website
              <input
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="example.com"
                value={website}
              />
            </label>
          </>
        ) : (
          <label className="lead-create-wide">
            Contact
            <Select
              ariaLabel="Lead contact"
              onChange={setContactId}
              options={[
                { value: newRecordValue, label: "Create new contact" },
                ...companyContacts.map((contact) => ({
                  value: contact.id,
                  label: `${contact.firstName} ${contact.lastName}${contact.email ? ` - ${contact.email}` : ""}`
                }))
              ]}
              value={contactId}
            />
          </label>
        )}
        {creatingContact ? (
          <>
            <label>
              First name
              <input
                maxLength={80}
                onChange={(event) => setFirstName(event.target.value)}
                required
                value={firstName}
              />
            </label>
            <label>
              Last name
              <input
                maxLength={80}
                onChange={(event) => setLastName(event.target.value)}
                required
                value={lastName}
              />
            </label>
            <label>
              Job title
              <input onChange={(event) => setTitle(event.target.value)} value={title} />
            </label>
            <label>
              Email
              <input
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
            <label>
              Phone
              <input onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
            </label>
            <label>
              WhatsApp number
              <input
                onChange={(event) => setWhatsappId(event.target.value)}
                placeholder="Country code and number"
                type="tel"
                value={whatsappId}
              />
            </label>
            <label>
              Preferred channel
              <Select
                ariaLabel="Preferred contact channel"
                onChange={setPreferredChannel}
                options={[
                  { value: "EMAIL", label: "Email" },
                  { value: "PHONE", label: "Phone" },
                  { value: "WHATSAPP", label: "WhatsApp" }
                ]}
                value={preferredChannel}
              />
            </label>
          </>
        ) : null}
        <label>
          Source
          <Select
            ariaLabel="Lead source"
            onChange={setSource}
            options={[
              { value: "Website", label: "Website" },
              { value: "Referral", label: "Referral" },
              { value: "Campaign", label: "Campaign" },
              { value: "WhatsApp", label: "WhatsApp" },
              { value: "Email", label: "Email" },
              { value: "Inbound call", label: "Inbound call" },
              { value: "Manual", label: "Manual" }
            ]}
            value={source}
          />
        </label>
        <label>
          Lead type
          <input
            onChange={(event) => setLeadType(event.target.value)}
            placeholder="New business, existing customer..."
            value={leadType}
          />
        </label>
        <label>
          Country
          <input
            autoComplete="country-name"
            onChange={(event) => setCountry(event.target.value)}
            value={country}
          />
        </label>
        <label>
          Priority
          <Select
            ariaLabel="Lead priority"
            onChange={setPriority}
            options={[
              { value: "NORMAL", label: "Normal" },
              { value: "HIGH", label: "High" },
              { value: "URGENT", label: "Urgent" }
            ]}
            value={priority}
          />
        </label>
        <label>
          Campaign
          <input onChange={(event) => setCampaign(event.target.value)} value={campaign} />
        </label>
        <label className="lead-create-wide">
          Requirement
          <textarea
            onChange={(event) => setRequirement(event.target.value)}
            placeholder="What does this lead need?"
            rows={3}
            value={requirement}
          />
        </label>
        <label>
          Service interest
          <input
            onChange={(event) => setServiceInterest(event.target.value)}
            value={serviceInterest}
          />
        </label>
        <label>
          Estimated value (INR)
          <input
            min="0"
            onChange={(event) => setEstimatedValue(event.target.value)}
            type="number"
            value={estimatedValue}
          />
        </label>
        <label>
          Owner
          <Select
            ariaLabel="Lead owner"
            onChange={setOwnerId}
            options={[
              { value: "", label: "Unassigned" },
              ...users.map((user) => ({
                value: user.id,
                label: `${user.firstName} ${user.lastName}`
              }))
            ]}
            value={ownerId}
          />
        </label>
        <label>
          Next action
          <input onChange={(event) => setNextAction(event.target.value)} value={nextAction} />
        </label>
      </div>
      <footer>
        <Button
          disabled={
            busy ||
            loadingRelationships ||
            (creatingCompany && !companyName.trim()) ||
            (creatingContact && (!firstName.trim() || !lastName.trim()))
          }
          type="submit"
          variant="primary"
        >
          {busy ? "Creating lead" : "Create lead"}
        </Button>
      </footer>
    </form>
  );
}

function HumanEmailForm({
  lead,
  currentUser,
  onSend
}: {
  lead: LeadDto;
  currentUser: PublicUser;
  onSend: (subject: string, body: string) => Promise<void>;
}): React.JSX.Element {
  const sender = lead.owner ?? currentUser;
  const [subject, setSubject] = useState(`Discovery: ${lead.company.name}`);
  const [body, setBody] = useState(
    `Hi ${lead.contact.firstName},\n\nThank you for your interest in ${lead.serviceInterest ?? "our services"}. I would like to understand your requirements and timeline. Could we arrange a short discovery call?\n\nBest regards,\n${sender.firstName} ${sender.lastName}`
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      await onSend(subject.trim(), body.trim());
    } catch (sendError) {
      setError(
        sendError instanceof Error && sendError.message.trim()
          ? sendError.message
          : "The email could not be sent."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="record-create-form human-email-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="human-email-recipient">
        To <strong>{lead.contact.email}</strong>
      </p>
      <div className="record-create-grid">
        <label className="record-create-wide">
          Subject
          <input
            autoFocus
            maxLength={500}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </label>
        <label className="record-create-wide">
          Message
          <textarea
            maxLength={20000}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={8}
            value={body}
          />
        </label>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <Button
          disabled={sending || !subject.trim() || !body.trim()}
          type="submit"
          variant="primary"
        >
          <Mail size={16} /> {sending ? "Sending..." : "Send email"}
        </Button>
      </footer>
    </form>
  );
}

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

  if (
    ![
      "workspace",
      "lead",
      "contact",
      "company",
      "conversation",
      "qualification",
      "proposal",
      "meeting",
      "deal",
      "task",
      "activity",
      "notifications",
      "domain-event"
    ].includes(event.entityType)
  ) {
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

  if (event.entityType === "conversation" || event.entityType === "activity") {
    plan.conversations = true;
  }
  if (event.entityType === "qualification") {
    plan.qualification = true;
  }
  if (event.entityType === "proposal") {
    plan.proposals = true;
  }
  if (event.entityType === "meeting") {
    plan.meetings = true;
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
  return formatDateTime(value, "No activity");
}

function formatScheduledDate(value: string | null): string {
  return value ? formatDate(value) : "Not scheduled";
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

function formatBusinessLabel(value: string | null | undefined, fallback = "Not set"): string {
  if (!value) {
    return fallback;
  }

  const label = value.replaceAll("_", " ").trim().toLowerCase();
  return label.length > 0 ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : fallback;
}

function proposalTimelineNotice(status: string): string | null {
  if (status === "FAILED") {
    return "The proposal email was sent, but Zoho Bigin timeline sync needs attention.";
  }
  if (status === "NOT_CONFIGURED") {
    return "The proposal email was sent. Connect Zoho Bigin to add it to the external timeline.";
  }
  return null;
}

function conversationSenderLabel(message: MessageDto): string {
  if (message.direction === "INBOUND") return "Customer";
  if (message.senderType === "USER") return "You";
  if (message.senderType === "AI") return "AI follow-up";
  if (message.senderType === "SYSTEM") return "Automated message";
  return formatBusinessLabel(message.senderType);
}

function formatOwnershipLabel(state: LeadDto["automationOwnershipState"]): string {
  if (state === "AI_ACTIVE") return "AI following up";
  if (state === "HUMAN_REQUIRED") return "Needs your response";
  if (state === "HUMAN_ACTION_COMPLETED") return "Handing over to AI";
  if (state === "AI_STOPPED") return "AI stopped";
  return "Handled by you";
}

function formatOwnershipReason(reason: string | null): string {
  if (!reason) return "No action is currently blocked";
  if (/reply|inbound/iu.test(reason)) return "A customer reply needs your attention";
  if (/negotiat|pricing|legal|discount/iu.test(reason))
    return "Commercial review needs your approval";
  if (/do.not.contact|dnc/iu.test(reason)) return "The customer must not be contacted";
  if (/lost|won|closed|terminal/iu.test(reason)) return "This opportunity is closed";
  if (/pause|takeover/iu.test(reason)) return "A person paused the automation";
  if (/provider|failed|error/iu.test(reason)) return "Delivery needs attention";
  return "Responsibility for the next action was updated";
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
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
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
  const latestListPageRef = useRef<PaginatedResponse<LeadDto> | null>(null);
  const workspaceRequestRef = useRef(0);
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;
  const whatsappReplyAttemptRef = useRef<{ conversationId: string; body: string; key: string } | null>(null);
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
      if (listRequest === listRequestRef.current) latestListPageRef.current = leadsPage;
      setState((current) => ({
        leadsPage: latestListPageRef.current ?? current.leadsPage ?? leadsPage,
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
    if (["Overview", "Proposals"].includes(activeTab) && state.selectedLead) {
      void loadLeadProposals(state.selectedLead.id);
    }
  }, [accessToken, activeTab, state.selectedLead?.id]);

  useEffect(() => {
    if (["Overview", "Meetings"].includes(activeTab) && state.selectedLead) {
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
      latestListPageRef.current = leadsPage;
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

  async function sendTrackedLeadEmail(subject: string, body: string): Promise<void> {
    const lead = state.selectedLead;
    if (!lead?.contact.email) throw new Error("This lead does not have an email address.");

    const conversations = await listConversations(accessToken, {
      leadId: lead.id,
      channel: "EMAIL",
      status: "OPEN"
    });
    let conversation = conversations[0] ?? null;
    if (!conversation) {
      conversation = await createConversation(accessToken, {
        leadId: lead.id,
        channel: "EMAIL",
        mode: "HUMAN"
      });
    } else if (conversation.mode !== "HUMAN") {
      await startHumanTakeover(accessToken, conversation.id, {
        reason: "Salesperson composing a tracked CRM email"
      });
    }

    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `human-email-${Date.now().toString()}`;
    const result = await sendHumanConversationReply(accessToken, conversation.id, {
      subject,
      body,
      idempotencyKey
    });
    if (result.outboundEmail.status !== "SENT") {
      throw new Error(
        result.outboundEmail.failureMessage ??
          `Email provider returned ${result.outboundEmail.status.replaceAll("_", " ").toLowerCase()}.`
      );
    }

    setEmailComposerOpen(false);
    toast.success({
      title: "Email sent",
      detail: "Human action recorded. The workspace is refreshing."
    });

    const [tasksResult, activitiesResult] = await Promise.allSettled([
      listTasks(accessToken, { leadId: lead.id }),
      listLeadActivities(accessToken, lead.id)
    ]);
    if (tasksResult.status === "fulfilled") {
      const tasks = tasksResult.value;
      setTaskState({ tasks, loading: false, error: null });
      setWorkspaceTasks((current) => [
        ...current.filter((task) => task.leadId !== lead.id),
        ...tasks
      ]);
    }
    if (activitiesResult.status === "fulfilled") {
      setState((current) => ({ ...current, activities: activitiesResult.value }));
    }
    await Promise.allSettled([
      refreshLeadList(filters),
      refreshSelectedLead(lead.id),
      loadLeadConversations(lead.id)
    ]);
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

    const conversation = conversationState.selectedConversation;
    setConversationState((current) => ({ ...current, saving: true, error: null }));
    try {
      if (conversation.channel === "WHATSAPP") {
        const previous = whatsappReplyAttemptRef.current;
        const key = previous?.conversationId === conversation.id && previous.body === body
          ? previous.key
          : typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `human-whatsapp-${Date.now().toString()}`;
        whatsappReplyAttemptRef.current = { conversationId: conversation.id, body, key };
        const result = await sendHumanWhatsAppConversationReply(accessToken, conversation.id, {
          body,
          idempotencyKey: key
        });
        if (result.status !== "SENT") {
          if (result.status !== "PENDING") whatsappReplyAttemptRef.current = null;
          const message = result.failureMessage ?? "WhatsApp delivery has not been confirmed. Check the integration before trying another message.";
          setConversationState((current) => ({ ...current, saving: false, error: message }));
          toast.error({ title: result.status === "PENDING" ? "WhatsApp delivery unconfirmed" : "WhatsApp reply not sent", detail: message });
          return;
        }
        whatsappReplyAttemptRef.current = null;
        const leadId = state.selectedLead.id;
        await Promise.all([
          refreshLeadList(filters),
          refreshSelectedLead(leadId),
          loadLeadConversations(leadId),
          loadLeadNotifications(leadId)
        ]);
        setConversationState((current) => ({ ...current, humanReplyInput: "", saving: false, error: null }));
        toast.success({ title: "WhatsApp reply sent" });
        return;
      }
      const latestFollowUp = conversationState.followUpSequences[0] ?? null;
      const reviewDraft =
        !conversationAutomationStopReason(state.selectedLead, conversation, latestFollowUp) &&
        latestFollowUp?.status === "ATTENTION_REQUIRED"
          ? latestFollowUp.reviewDraft
          : null;
      const idempotencyKey = reviewDraft
        ? `reviewed-follow-up:${reviewDraft.attemptId}`
        : typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `human-reply-${Date.now().toString()}`;
      const result: HumanConversationReplyDto = await sendHumanConversationReply(
        accessToken,
        conversationState.selectedConversation.id,
        {
          body,
          ...(reviewDraft ? { subject: reviewDraft.subject } : {}),
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
    if (!state.selectedLead || !canSimulateCustomerReply() || !isWorkspaceAdmin(currentUser)) {
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
        subject: `Re: ${state.selectedLead.company.name}`,
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
      const message = apiErrorMessage(error, "Customer reply could not be processed");
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

  function updateProposalDraftFields(
    patch: Partial<Pick<ProposalState, "draftTitle" | "draftContent" | "correctionSummary">>
  ): void {
    setProposalState((current) => {
      const next = { ...current, ...patch, error: null };
      proposalStateRef.current = next;
      return next;
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
    const currentProposal = proposalStateRef.current;
    if (!state.selectedLead || !currentProposal.selectedProposalId) {
      return;
    }

    setProposalState((current) => ({ ...current, saving: true, error: null }));

    try {
      const proposal = await updateProposalDraft(accessToken, currentProposal.selectedProposalId, {
        title: currentProposal.draftTitle,
        content: currentProposal.draftContent,
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
        meetingMode: meetingState.meetingMode,
        ...(meetingState.location.trim() ? { location: meetingState.location.trim() } : {}),
        reminderMinutes: meetingState.reminderMinutes,
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
        error: request.status === "CONFIRMED" ? null : request.providerLastError ?? "Meeting confirmation needs attention"
      }));
      if (state.selectedLead) {
        const activities = await listLeadActivities(accessToken, state.selectedLead.id).catch(
          () => state.activities
        );
        setState((current) => ({ ...current, activities }));
      }
      if (request.status === "CONFIRMED") toast.success({ title: "Meeting confirmed" });
      else toast.error({ title: "Meeting not confirmed", detail: request.providerLastError ?? "Check the calendar connection and try again" });
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

  async function cancelSelectedMeeting(meetingRequestId: string, reason: string): Promise<void> {
    setMeetingState((current) => ({ ...current, saving: true, error: null }));
    try {
      const request = await cancelMeetingRequest(accessToken, meetingRequestId, reason);
      setMeetingState((current) => ({
        ...current,
        requests: current.requests.map((item) => item.id === request.id ? request : item),
        saving: false,
        error: null
      }));
      if (state.selectedLead) {
        await Promise.all([
          refreshSelectedLead(state.selectedLead.id),
          listLeadActivities(accessToken, state.selectedLead.id).then((activities) =>
            setState((current) => ({ ...current, activities }))
          )
        ]);
      }
      toast.success({ title: "Meeting cancelled" });
    } catch (error) {
      const message = apiErrorMessage(error, "Meeting could not be cancelled");
      setMeetingState((current) => ({ ...current, saving: false, error: message }));
      toast.error({ title: "Cancellation not completed", detail: message });
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

  const canSyncZoho = isWorkspaceManager(currentUser);
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
            <button
              className="workspace-create-button"
              onClick={() => setCreateLeadOpen(true)}
              type="button"
            >
              <Plus size={16} />
              New lead
            </button>
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
            accessToken={accessToken}
            activeTab={activeTab}
            activities={state.activities}
            notifications={state.notifications}
            lead={state.selectedLead}
            stages={state.stages}
            users={state.users}
            conversationState={conversationState}
            currentUser={currentUser}
            onAssignOwner={persistOwner}
            onLeadUpdated={async (lead) => {
              await loadWorkspace(filters, lead.id);
            }}
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
            onMeetingCancel={cancelSelectedMeeting}
            onMeetingDraftChange={updateMeetingDraft}
            onMeetingRefresh={loadLeadMeetings}
            onMeetingRequest={requestMeetingSlots}
            onProposalApprove={approveSelectedProposal}
            onProposalDraftChange={updateProposalDraftFields}
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
            onComposeEmail={() => setEmailComposerOpen(true)}
            onBack={() => onRouteChange?.(null)}
          />
        ) : null}
      </div>
      {!isProfile ? (
        <>
          <LeadQuickView
            activities={state.activities}
            lead={state.selectedLead}
            tasks={taskState.tasks}
            tasksLoading={taskState.loading}
            tasksError={taskState.error}
            meetings={meetingState.requests}
            open={quickViewOpen}
            onClose={() => setQuickViewOpen(false)}
            onCompleteTask={completeLeadTask}
            onComposeEmail={() => setEmailComposerOpen(true)}
            onOpenProfile={() => {
              if (state.selectedLead) onRouteChange?.(state.selectedLead.id, "Overview");
            }}
          />
          <Modal open={createLeadOpen} onClose={() => setCreateLeadOpen(false)} title="New lead">
            <NewLeadForm
              accessToken={accessToken}
              currentUser={currentUser}
              users={state.users}
              onCreated={async (lead) => {
                setCreateLeadOpen(false);
                await loadWorkspace({ ...initialFilters, search: undefined }, lead.id);
                toast.success({
                  title: "Lead created",
                  detail: `${lead.contact.firstName} ${lead.contact.lastName}`
                });
                onRouteChange?.(lead.id, "Overview");
              }}
            />
          </Modal>
        </>
      ) : null}
      <Modal
        open={emailComposerOpen && Boolean(state.selectedLead?.contact.email)}
        onClose={() => setEmailComposerOpen(false)}
        title="Send email"
      >
        {state.selectedLead?.contact.email ? (
          <HumanEmailForm
            key={state.selectedLead.id}
            currentUser={currentUser}
            lead={state.selectedLead}
            onSend={sendTrackedLeadEmail}
          />
        ) : null}
      </Modal>
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
              aria-label={`Open ${leadName(lead)}`}
              className={`lead-row ${lead.id === selectedLeadId ? "selected" : ""}`}
              key={lead.id}
              onClick={() => void onSelect(lead.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void onSelect(lead.id);
                }
              }}
              role="row"
              tabIndex={0}
            >
              <span>
                <input
                  aria-label={`Select ${leadName(lead)}`}
                  checked={selectedIds.has(lead.id)}
                  onChange={() => toggle(lead.id)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  type="checkbox"
                />
              </span>
              <div className="lead-primary-cell">
                <span className="lead-avatar" aria-hidden="true">
                  {lead.contact.firstName.slice(0, 1)}
                  {lead.contact.lastName.slice(0, 1)}
                </span>
                <span>
                  <strong>{leadName(lead)}</strong>
                  <small>{lead.contact.email ?? "No email"}</small>
                </span>
              </div>
              <span title={lead.company.name}>{lead.company.name}</span>
              <span
                title={lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
              >
                {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
              </span>
              <span>
                <StatusBadge tone="neutral">{lead.status.replaceAll("_", " ")}</StatusBadge>
              </span>
              <span title={lead.stage.label}>{lead.stage.label}</span>
              <span title={priority === "NONE" ? "No priority" : priority}>
                {priority === "NONE" ? "-" : priority}
              </span>
              <span>
                <strong>{lead.score}</strong>
                <small>{lead.temperature}</small>
              </span>
              <span title={lead.nextAction ?? "No next action"}>
                {lead.nextAction ?? "No next action"}
              </span>
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

function LeadMetadataForm({
  accessToken,
  lead,
  onSaved
}: {
  accessToken: string;
  lead: LeadDto;
  onSaved: (lead: LeadDto) => Promise<void>;
}): React.JSX.Element {
  const [source, setSource] = useState(lead.source);
  const [leadType, setLeadType] = useState(lead.leadType ?? "");
  const [country, setCountry] = useState(lead.country ?? "");
  const [campaign, setCampaign] = useState(lead.campaign ?? "");
  const [priority, setPriority] = useState(lead.priority ?? "NORMAL");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="record-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        void updateLeadDetails(accessToken, lead.id, {
          source: source.trim(),
          leadType: leadType.trim() || null,
          country: country.trim() || null,
          campaign: campaign.trim() || null,
          priority
        })
          .then(onSaved)
          .catch((saveError: unknown) =>
            setError(apiErrorMessage(saveError, "Lead details could not be saved."))
          )
          .finally(() => setSaving(false));
      }}
    >
      <div className="record-create-grid">
        <label>
          Source
          <input onChange={(event) => setSource(event.target.value)} required value={source} />
        </label>
        <label>
          Lead type
          <input onChange={(event) => setLeadType(event.target.value)} value={leadType} />
        </label>
        <label>
          Country
          <input autoComplete="country-name" onChange={(event) => setCountry(event.target.value)} value={country} />
        </label>
        <label>
          Priority
          <Select
            ariaLabel="Lead priority"
            onChange={setPriority}
            options={[
              { value: "NORMAL", label: "Normal" },
              { value: "HIGH", label: "High" },
              { value: "URGENT", label: "Urgent" }
            ]}
            value={priority}
          />
        </label>
        <label className="record-create-wide">
          Campaign
          <input onChange={(event) => setCampaign(event.target.value)} value={campaign} />
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer>
        <Button disabled={saving || !source.trim()} type="submit" variant="primary">
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </footer>
    </form>
  );
}

function LeadDetail({
  accessToken,
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
  onLeadUpdated,
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
  onMeetingCancel,
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
  onComposeEmail,
  onBack
}: {
  accessToken: string;
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
  onLeadUpdated: (lead: LeadDto) => Promise<void>;
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
  onMeetingCancel: (meetingRequestId: string, reason: string) => Promise<void>;
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
  onComposeEmail: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
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
  const useFollowUpAction = lead.automationOwnershipState === "AI_ACTIVE" ? followUpAction : null;
  const nextAction = useFollowUpAction?.nextAction ?? lead.nextAction ?? "No next action";
  const nextActionAt = useFollowUpAction?.nextActionAt ?? lead.nextActionAt ?? null;

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
          <button onClick={() => setEditDetailsOpen(true)} type="button">
            <Pencil size={16} /> Edit details
          </button>
          {lead.contact.email && !lead.contact.doNotContact ? (
            <button onClick={onComposeEmail} type="button">
              <Mail size={16} /> Email
            </button>
          ) : null}
          {lead.contact.phone && !lead.contact.doNotContact ? (
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

      <LeadFactStrip lead={lead} tasks={taskState.tasks} />

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
          <strong>
            {nextActionAt ? `${nextAction} · ${formatDate(nextActionAt)}` : nextAction}
          </strong>
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
        accessToken={accessToken}
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
        onMeetingCancel={onMeetingCancel}
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
        onComposeEmail={onComposeEmail}
      />
      <Modal open={editDetailsOpen} onClose={() => setEditDetailsOpen(false)} title="Edit lead details">
        <LeadMetadataForm
          accessToken={accessToken}
          key={lead.id}
          lead={lead}
          onSaved={async (updatedLead) => {
            await onLeadUpdated(updatedLead);
            setEditDetailsOpen(false);
          }}
        />
      </Modal>
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
  accessToken,
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
  onMeetingCancel,
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
  onCompleteTask,
  onComposeEmail
}: {
  accessToken: string;
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
  onMeetingCancel: (meetingRequestId: string, reason: string) => Promise<void>;
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
  onComposeEmail: () => void;
}): React.JSX.Element {
  if (tab === "Conversation") {
    return (
      <ConversationSimulator
        accessToken={accessToken}
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
        accessToken={accessToken}
        briefingState={briefingState}
        lead={lead}
        meetingState={meetingState}
        onConfirm={onMeetingConfirm}
        onCancel={onMeetingCancel}
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
        accessToken={accessToken}
        briefingState={briefingState}
        currentUser={currentUser}
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
          meta={`${String(taskState.tasks.length)} ${taskState.tasks.length === 1 ? "task" : "tasks"}`}
        >
          <LeadTaskList
            tasks={taskState.tasks}
            loading={taskState.loading}
            error={taskState.error}
            onComplete={onCompleteTask}
            onComposeEmail={onComposeEmail}
            automationOwnershipState={lead.automationOwnershipState}
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
            <TabData label="Next action due" value={formatScheduledDate(nextActionAt)} />
          </div>
        </TabSection>
      </div>
    );
  }

  if (tab === "Overview") {
    const openTaskCount = taskState.tasks.filter(
      (task) => task.status === "OPEN" || task.status === "IN_PROGRESS"
    ).length;
    const recentActivities = activities.slice(0, 3);
    const ownershipState = formatOwnershipLabel(lead.automationOwnershipState);

    return (
      <div className="tab-panel tab-panel-structured">
        <TabSection eyebrow="Overview" title="Operational overview" meta={ownershipState}>
          <div className="tab-data-grid">
            <TabData
              label="Requirement"
              value={lead.requirement ?? "Requirement not captured yet"}
            />
            <TabData label="Why" value={formatOwnershipReason(lead.automationOwnershipReason)} />
            <TabData label="Open tasks" value={String(openTaskCount)} />
            <TabData label="Proposal records" value={proposalState.loading ? "Loading" : proposalState.error ? "Unavailable" : String(proposalState.proposals.length)} />
            <TabData label="Meeting requests" value={meetingState.loading ? "Loading" : meetingState.error ? "Unavailable" : String(meetingState.requests.length)} />
            <TabData label="Lead type" value={lead.leadType ?? "Not set"} />
            <TabData label="Country" value={lead.country ?? "Not set"} />
            <TabData label="Priority" value={lead.priority ?? "Normal"} />
            <TabData label="Campaign" value={lead.campaign ?? "Not set"} />
            <TabData label="Preferred channel" value={lead.contact.preferredChannel ?? "Not set"} />
            <TabData label="Next action due" value={formatScheduledDate(nextActionAt)} />
          </div>
        </TabSection>
        <TabSection
          eyebrow="Recent activity"
          title="Latest updates"
          meta={`${String(activities.length)} total`}
        >
          {recentActivities.length === 0 ? (
            <StateBlock title="No activities yet" detail="New lead updates will appear here." />
          ) : (
            <LeadTimeline activities={recentActivities} />
          )}
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
  accessToken,
  briefingState,
  currentUser,
  lead,
  onGenerate
}: {
  accessToken: string;
  briefingState: BriefingState;
  currentUser: PublicUser;
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
      <LeadIntelligencePanel accessToken={accessToken} currentUser={currentUser} leadId={lead.id} />
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
          <div className="ai-insights-empty" role="status">
            <strong>No lead briefing yet</strong>
            <span>Generate one from real persisted evidence.</span>
          </div>
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

function meetingRequestStatusLabel(status: MeetingRequestDto["status"]): string {
  const labels: Record<MeetingRequestDto["status"], string> = {
    ATTENTION_REQUIRED: "Needs attention",
    CANCELLED: "Cancelled",
    CONFIRMATION_REQUIRED: "Choose a time",
    CONFIRMED: "Confirmed",
    PROVIDER_PENDING: "Creating calendar event"
  };
  return labels[status];
}

function meetingSyncStatusLabel(status: MeetingRequestDto["providerSyncStatus"]): string {
  const labels: Record<MeetingRequestDto["providerSyncStatus"], string> = {
    FAILED: "Update failed",
    NOT_CONFIGURED: "Not configured",
    NOT_REQUIRED: "Not needed",
    PENDING: "Update in progress",
    SYNCED: "Confirmed"
  };
  return labels[status];
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

function meetingConfirmationPhrase(slot: MeetingRequestDto["slots"][number]): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: slot.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(slot.startsAt));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `Confirm meeting ${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

function MeetingPanel({
  accessToken,
  briefingState,
  lead,
  meetingState,
  onConfirm,
  onCancel,
  onDraftChange,
  onGenerateBriefing,
  onRefresh,
  onRequest
}: {
  accessToken: string;
  briefingState: BriefingState;
  lead: LeadDto;
  meetingState: MeetingState;
  onConfirm: (meetingRequestId: string, slotId: string) => Promise<void>;
  onCancel: (meetingRequestId: string, reason: string) => Promise<void>;
  onDraftChange: (patch: Partial<MeetingState>) => void;
  onGenerateBriefing: (meetingRequestId: string) => Promise<void>;
  onRefresh: (leadId: string) => Promise<void>;
  onRequest: () => Promise<void>;
}): React.JSX.Element {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const toast = useToast();
  const currentRequest = selectCurrentMeetingRequest(meetingState.requests);
  const historicalRequests = currentRequest
    ? meetingState.requests.filter((request) => request.id !== currentRequest.id)
    : [];
  const currentHasSlots = currentRequest ? meetingRequestHasProposedSlots(currentRequest) : false;
  const canRequest =
    meetingState.windowStart.trim().length > 0 &&
    meetingState.windowEnd.trim().length > 0 &&
    (meetingState.meetingMode === "VIDEO" || meetingState.location.trim().length >= 3) &&
    !currentHasSlots;

  const renderRequestCard = (request: MeetingRequestDto, options?: { historical?: boolean }) => {
    const briefing = briefingState.meetingBriefings.find(
      (item) => item.meetingRequestId === request.id
    );
    const proposedSlots = request.slots.filter((slot) => slot.status === "PROPOSED");
    const visibleSlots = request.slots.filter((slot) => slot.status === "SELECTED");
    const confirmedSlot = confirmedMeetingSlot(request);
    return (
      <article
        className={`proposal-list-item meeting-request-card${options?.historical ? " historical" : ""}`}
        key={request.id}
      >
        <div className="meeting-request-summary">
          <strong>{request.title}</strong>
          <span>{meetingRequestStatusLabel(request.status)}</span>
          <small>{request.meetingMode === "PHONE" ? "Telephone" : request.meetingMode === "IN_PERSON" ? "In-person" : "Video meeting"}{request.location ? ` / ${request.location}` : ""}</small>
          {request.status === "CONFIRMED" && !request.outcome ? <small>{request.reminderMinutes === 0 ? "Reminder off" : `Team reminder ${String(request.reminderMinutes)} minutes before the meeting${request.reminderSentAt ? " / Sent" : ""}`}</small> : null}
          <small>
            {request.status === "CANCELLED"
              ? request.providerMeetingId ? "Calendar cancellation: Confirmed" : "Calendar event: Not created"
              : `Calendar: ${meetingSyncStatusLabel(request.providerSyncStatus)}`}
            {request.status !== "CANCELLED" && request.zohoSyncStatus !== "NOT_REQUIRED"
              ? ` / Zoho Bigin: ${meetingSyncStatusLabel(request.zohoSyncStatus)}`
              : ""}
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
              Calendar
            </span>
            <span>
              <strong>Organizer</strong>
              {request.providerOrganizerEmail ?? "Verified organizer not stored yet"}
            </span>
            {request.providerMeetingUrl ? (
              <a href={request.providerMeetingUrl} rel="noreferrer" target="_blank">
                Open calendar event
              </a>
            ) : null}
          </div>
        ) : null}
        {briefing ? <BriefingCard run={briefing} /> : null}
        <MeetingLifecycleActions accessToken={accessToken} meeting={request} onRefresh={onRefresh} />
        {proposedSlots.length > 0 ? (
          <div className="meeting-slot-grid" aria-label="Available meeting slots">
            {proposedSlots.map((slot) => (
              <div className="meeting-slot-option" key={slot.id}>
              <button
                disabled={meetingState.saving || request.status !== "CONFIRMATION_REQUIRED"}
                key={slot.id}
                onClick={() => void onConfirm(request.id, slot.id)}
                type="button"
              >
                <Icon name="check" size={15} />
                Confirm {formatSlotRange(slot)}
              </button>
              <Button variant="secondary" type="button" disabled={meetingState.saving || request.status !== "CONFIRMATION_REQUIRED"} onClick={() => {
                void navigator.clipboard.writeText(`We can meet at ${formatSlotRange(slot)}. To confirm this time, reply with: ${meetingConfirmationPhrase(slot)}`).then(
                  () => toast.success({ title: "Meeting time copied" }),
                  () => toast.error({ title: "Meeting time could not be copied" })
                );
              }}><Copy size={15} />Copy invitation</Button>
              </div>
            ))}
          </div>
        ) : visibleSlots.length > 0 ? (
          <div className="meeting-slot-list" aria-label="Persisted meeting slots">
            {visibleSlots.map((slot) => (
              <span className={slot.status.toLowerCase()} key={slot.id}>
                <strong>Selected time</strong>
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
        {request.status !== "CANCELLED" && !request.outcome ? (
          cancellingId === request.id ? (
            <form className="meeting-cancel-form" onSubmit={(event) => {
              event.preventDefault();
              void onCancel(request.id, cancelReason.trim());
            }}>
              <label>
                Reason for cancellation
                <input
                  autoFocus
                  maxLength={500}
                  minLength={3}
                  onChange={(event) => setCancelReason(event.target.value)}
                  required
                  value={cancelReason}
                />
              </label>
              <div className="proposal-actions">
                <Button type="button" variant="secondary" onClick={() => setCancellingId(null)}>Keep meeting</Button>
                <Button type="submit" variant="danger" disabled={meetingState.saving || cancelReason.trim().length < 3}>Confirm cancellation</Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="secondary" disabled={meetingState.saving} onClick={() => setCancellingId(request.id)}>Cancel meeting</Button>
          )
        ) : null}
      </article>
    );
  };

  return (
    <div className="tab-panel meeting-panel">
      <section className="meeting-editor" aria-label="Meeting scheduling">
        <header className="proposal-editor-head">
          <div>
            <p className="eyebrow">Meetings</p>
            <h3>Schedule meeting</h3>
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
          <label className="proposal-field">Meeting type
            <Select ariaLabel="Meeting type" value={meetingState.meetingMode} disabled={meetingState.saving} onChange={(value) => onDraftChange({ meetingMode: value as MeetingState["meetingMode"] })} options={[{ value: "VIDEO", label: "Video meeting" }, { value: "PHONE", label: "Telephone" }, { value: "IN_PERSON", label: "In-person" }]} />
          </label>
          <label className="proposal-field">Team reminder
            <Select ariaLabel="Meeting reminder" value={String(meetingState.reminderMinutes)} disabled={meetingState.saving} onChange={(value) => onDraftChange({ reminderMinutes: Number(value) })} options={[{ value: "0", label: "Off" }, { value: "15", label: "15 minutes before" }, { value: "30", label: "30 minutes before" }, { value: "60", label: "1 hour before" }, { value: "1440", label: "1 day before" }]} />
          </label>
          {meetingState.meetingMode !== "VIDEO" ? <label className="proposal-field">{meetingState.meetingMode === "PHONE" ? "Phone number" : "Meeting address"}<input required maxLength={500} value={meetingState.location} onChange={(event) => onDraftChange({ location: event.target.value })} disabled={meetingState.saving} /></label> : null}
        </div>
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
            {currentHasSlots ? "Times available" : "Find available times"}
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

function proposalStatusLabel(status: ProposalDto["status"]): string {
  const labels: Record<ProposalDto["status"], string> = {
    APPROVED: "Approved",
    DRAFT: "Draft",
    SENT: "Sent",
    WAITING_APPROVAL: "Needs approval"
  };
  return labels[status];
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
  const canApprove = isWorkspaceManager(currentUser);
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
              <span>{proposalStatusLabel(proposal.status)}</span>
              <small>v{proposal.currentVersion?.version ?? 0}</small>
            </button>
          ))}
        </div>
      ) : null}

      {selectedProposal ? (
        <section className="proposal-editor" aria-label="Proposal review">
          <header className="proposal-editor-head">
            <div>
              <p className="eyebrow">Proposal</p>
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
              {proposalStatusLabel(selectedProposal.status)}
            </StatusBadge>
          </header>

          <div className="proposal-meta">
            <span>Created {formatDate(selectedProposal.createdAt)}</span>
            <span>
              Approved{" "}
              {selectedProposal.approvedAt ? formatDate(selectedProposal.approvedAt) : "not yet"}
            </span>
            {selectedProposal.zohoTimelineSyncStatus !== "NOT_REQUIRED" ? (
              <span>Zoho Bigin {formatBusinessLabel(selectedProposal.zohoTimelineSyncStatus)}</span>
            ) : null}
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

          <details className="correction-panel" aria-label="Optional proposal feedback">
            <summary>
              <span>Improve future drafts (optional)</span>
              <StatusBadge tone="neutral">{proposalState.corrections.length}</StatusBadge>
            </summary>
            <div className="correction-panel-body">
              <label className="proposal-field">
                What should be corrected?
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
                  Save feedback
                </button>
              </div>
              {proposalState.corrections.length > 0 ? (
                <div className="correction-history">
                  {proposalState.corrections.slice(0, 3).map((correction) => (
                    <article key={correction.id}>
                      <strong>Version {correction.version} feedback</strong>
                      <span>{correction.correctionSummary}</span>
                      <small>{formatDate(correction.createdAt)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No feedback has been recorded for this proposal.</p>
              )}
            </div>
          </details>

          {proposalTimelineNotice(selectedProposal.zohoTimelineSyncStatus) ? (
            <p className="form-error">
              {proposalTimelineNotice(selectedProposal.zohoTimelineSyncStatus)}
            </p>
          ) : null}
          {proposalState.error ? <p className="form-error">{proposalState.error}</p> : null}
          {proposalState.sendResult ? (
            <div className="proposal-send-result" role="status">
              <span>
                Email {formatBusinessLabel(proposalState.sendResult.outboundEmail.status)}
              </span>
              {proposalState.sendResult.zohoTimeline &&
              proposalState.sendResult.zohoTimeline.status !== "SKIPPED" ? (
                <span>
                  Zoho Bigin {formatBusinessLabel(proposalState.sendResult.zohoTimeline.status)}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="proposal-actions proposal-primary-actions">
            {canEdit ? (
              <button
                disabled={
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
            ) : null}
            {canApprove && selectedProposal.status === "WAITING_APPROVAL" ? (
              <button
                disabled={proposalState.saving || !latestVersion}
                onClick={() => void onApprove()}
                type="button"
              >
                <Icon name="check" size={16} />
                Approve
              </button>
            ) : null}
            {canSend ? (
              <button
                disabled={proposalState.saving || !selectedProposal.approvedVersion}
                onClick={() => void onSend()}
                type="button"
              >
                <Icon name="send" size={16} />
                Send approved
              </button>
            ) : null}
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

function conversationContactStopReason(lead: LeadDto): string | null {
  if (lead.contact.doNotContact) return "DO_NOT_CONTACT";
  if (
    ["WON", "LOST", "CLOSED", "DISQUALIFIED"].includes(lead.status) ||
    lead.stage.isClosed || ["WON", "LOST", "CLOSED", "DISQUALIFIED"].includes(lead.stage.key)
  ) return "TERMINAL";
  return null;
}

function conversationAutomationStopReason(
  lead: LeadDto,
  conversation: ConversationDto | null,
  sequence: FollowUpSequenceDto | null
): string | null {
  const contactStopReason = conversationContactStopReason(lead);
  if (contactStopReason) return contactStopReason;
  if (
    conversation?.mode === "PAUSED" ||
    /MANUAL_PAUSE|AI_PAUSED/u.test(lead.automationOwnershipReason ?? "")
  ) return "MANUAL_PAUSE";
  if (["AI_STOPPED", "STOPPED"].includes(lead.automationOwnershipState)) {
    return "AUTOMATION_STOPPED";
  }
  return sequence?.status === "STOPPED" ? sequence.stopReason ?? "AUTOMATION_STOPPED" : null;
}

function formatFollowUpNextAction(
  sequence: FollowUpSequenceDto | null,
  stoppedReason: string | null = null
): string {
  if (stoppedReason) {
    return formatFollowUpStopReason(stoppedReason);
  }
  if (!sequence) {
    return "No follow-up automation has been started for this lead.";
  }

  if (sequence.status === "ATTENTION_REQUIRED") {
    return (
      sequence.lastErrorMessage ?? "Attention required before follow-up automation can continue."
    );
  }

  if (sequence.status === "STOPPED") {
    return formatFollowUpStopReason(sequence.stopReason ?? "");
  }

  if (sequence.status === "COMPLETED") {
    return "Email follow-up is complete. The next channel action is shown above.";
  }

  const attempt = nextFollowUpAttempt(sequence);
  if (!attempt) {
    return "No scheduled follow-up attempts are pending.";
  }
  const action = activeFollowUpLeadAction([sequence]);
  return action
    ? `${action.nextAction} scheduled for ${formatDate(action.nextActionAt)}`
    : "No next action";
}

function formatFollowUpStopReason(reason: string): string {
  if (reason.includes("MEANINGFUL_CLIENT_REPLY") || reason.includes("INBOUND_REPLY")) {
    return "Customer replied. AI follow-up is paused until you respond.";
  }
  if (reason.includes("DO_NOT_CONTACT")) {
    return "Follow-up is stopped because this contact must not be contacted.";
  }
  if (reason.includes("MANUAL_PAUSE") || reason.includes("AI_PAUSED")) {
    return "Follow-up was paused by a manager.";
  }
  if (
    reason.includes("LEAD_WON") ||
    reason.includes("LEAD_LOST") ||
    reason.includes("TERMINAL")
  ) {
    return "Follow-up is stopped because this opportunity is closed.";
  }
  return "Follow-up automation is stopped.";
}

function formatFollowUpStatus(status: FollowUpSequenceDto["status"]): string {
  if (status === "ATTENTION_REQUIRED") return "Needs attention";
  if (status === "ACTIVE") return "Active";
  if (status === "STOPPED") return "Stopped";
  return "Complete";
}

function ConversationSimulator({
  accessToken,
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
  accessToken: string;
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
  const channels = [...new Set(conversationState.conversations.map((item) => item.channel))];
  const conversationsInChannel = conversationState.conversations.filter(
    (item) => item.channel === selectedConversation?.channel
  );
  const isHumanConversation = selectedConversation?.mode === "HUMAN";
  const isHumanOwned = isHumanConversation || ["HUMAN_ACTIVE", "HUMAN_REQUIRED", "HUMAN_ACTION_COMPLETED"].includes(lead.automationOwnershipState);
  const isEmailConversation = selectedConversation?.channel === "EMAIL";
  const isWhatsAppConversation = selectedConversation?.channel === "WHATSAPP";
  const latestFollowUp = conversationState.followUpSequences[0] ?? null;
  const humanContactBlocked = Boolean(conversationContactStopReason(lead)) || selectedConversation?.status === "CLOSED";
  const stoppedReason = conversationAutomationStopReason(lead, selectedConversation, latestFollowUp);
  const followUpStatus = stoppedReason ? "STOPPED" : latestFollowUp?.status;
  const reviewDraft =
    !stoppedReason && latestFollowUp?.status === "ATTENTION_REQUIRED" ? latestFollowUp.reviewDraft : null;
  const nextAttempt = stoppedReason ? null : nextFollowUpAttempt(latestFollowUp);
  const canSubmitE2ECustomerReply = !stoppedReason && canSimulateCustomerReply() && isWorkspaceAdmin(currentUser);
  const canUseAdvancedTestingTools = !humanContactBlocked && isWorkspaceAdmin(currentUser);
  const e2eAcceleratableSequenceId =
    !stoppedReason &&
    isE2ELocalUi() &&
    isWorkspaceAdmin(currentUser) &&
    latestFollowUp?.status === "ACTIVE" &&
    latestFollowUp.e2eAccelerationEligible &&
    latestFollowUp.cadenceMode !== "E2E_ACCELERATED_MINUTES"
      ? latestFollowUp.id
      : null;
  const messageActivities = activities
    .filter((activity) => activity.type === "MESSAGE_RECEIVED" || activity.type === "MESSAGE_SENT")
    .slice(0, 4);
  const e2eCustomerReplyPanel = canSubmitE2ECustomerReply ? (
    <section className="e2e-customer-reply-panel" aria-label="Test customer reply">
      <header>
        <div>
          <p className="eyebrow">Local testing</p>
          <h3>Simulate an incoming customer email</h3>
        </div>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmitE2ECustomerReply();
        }}
      >
        <textarea
          aria-label="Test customer reply"
          onChange={(event) => onE2ECustomerReplyInputChange(event.target.value)}
          placeholder="Customer reply received by email"
          rows={3}
          value={conversationState.e2eReplyInput}
        />
        <Button
          variant="primary"
          disabled={conversationState.saving || conversationState.e2eReplyInput.trim().length === 0}
          type="submit"
        >
          <Icon name="send" size={16} />
          Receive customer reply
        </Button>
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
              <p className="eyebrow">Follow-up</p>
              <h3>AI follow-up</h3>
            </div>
            {followUpStatus ? (
              <StatusBadge tone={followUpStatus === "ATTENTION_REQUIRED" ? "warm" : "won"}>
                {formatFollowUpStatus(followUpStatus)}
              </StatusBadge>
            ) : null}
          </header>
          <p>{formatFollowUpNextAction(latestFollowUp, stoppedReason)}</p>
          {!stoppedReason ? (
            <p className="muted-copy">Send the required customer response to hand follow-up to AI.</p>
          ) : null}
        </section>
        {e2eCustomerReplyPanel}
        {canUseAdvancedTestingTools && !stoppedReason ? (
          <details className="advanced-testing-tools">
            <summary>Advanced testing tools</summary>
            <div className="simulator-empty internal-simulator">
              <StateBlock
                title="No test conversation"
                detail="The normal customer timeline above remains the source of truth."
                action={
                  <button
                    disabled={conversationState.saving}
                    onClick={() => void onStartConversation()}
                    type="button"
                  >
                    <Icon name="sparkles" size={16} />
                    Open test conversation
                  </button>
                }
              />
              {conversationState.error ? (
                <p className="form-error">{conversationState.error}</p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tab-panel simulator-panel">
      <section className="production-outreach-panel" aria-label="Production outreach">
        <header>
          <div>
            <p className="eyebrow">Follow-up</p>
            <h3>AI follow-up</h3>
          </div>
          {followUpStatus ? (
            <StatusBadge tone={followUpStatus === "ATTENTION_REQUIRED" ? "warm" : "won"}>
              {formatFollowUpStatus(followUpStatus)}
            </StatusBadge>
          ) : null}
        </header>
        <p>{formatFollowUpNextAction(latestFollowUp, stoppedReason)}</p>
        {!stoppedReason && latestFollowUp?.status === "ATTENTION_REQUIRED" &&
        !reviewDraft &&
        ["FOLLOW_UP_REQUIRES_REVIEW", "AI_AUTOMATION_START_FAILED"].includes(
          lead.automationOwnershipReason ?? ""
        ) ? (
          <Button
            variant="secondary"
            disabled={conversationState.saving}
            onClick={() => void onModeChange("AUTO")}
            type="button"
          >
            <Icon name="refresh" size={16} />
            Prepare follow-up again
          </Button>
        ) : null}
        {!stoppedReason && isHumanOwned ? (
          <p className="muted-copy">
            Automation is paused while the assigned salesperson handles this conversation.
          </p>
        ) : null}
        {nextAttempt ? (
          <div className="automation-grid">
            <span>
              <strong>Next action</strong>
              {activeFollowUpLeadAction(latestFollowUp ? [latestFollowUp] : [])?.nextAction ??
                "No next action"}
            </span>
            <span>
              <strong>Scheduled</strong>
              {formatDate(nextAttempt.scheduledAt)}
            </span>
            <span>
              <strong>Status</strong>
              {formatBusinessLabel(nextAttempt.status)}
            </span>
          </div>
        ) : null}
        {!stoppedReason && !isHumanOwned &&
        lead.automationOwnershipState === "AI_ACTIVE" &&
        !latestFollowUp ? (
          <div className="proposal-actions">
            <button
              disabled={conversationState.saving}
              onClick={() => void onStartFollowUp()}
              type="button"
            >
              <Icon name="send" size={16} />
              Start AI follow-up
            </button>
          </div>
        ) : null}
      </section>
      {e2eCustomerReplyPanel}

      {conversationState.error ? <p className="form-error">{conversationState.error}</p> : null}
      <nav className="conversation-channels" aria-label="Message channels">
        {channels.map((channel) => {
          const channelConversations = conversationState.conversations.filter(
            (item) => item.channel === channel
          );
          return (
            <button
              aria-pressed={selectedConversation.channel === channel}
              className={selectedConversation.channel === channel ? "active" : ""}
              key={channel}
              onClick={() => {
                const target = channelConversations[0];
                if (target && target.id !== selectedConversation.id)
                  void onConversationChange(target.id);
              }}
              type="button"
            >
              {channel === "WHATSAPP" ? "WhatsApp" : channel === "WEBSITE" ? "Website" : channel === "INTERNAL" ? "Internal" : "Email"}
              <span>{channelConversations.length}</span>
            </button>
          );
        })}
        {conversationsInChannel.length > 1 ? (
          <Select
            ariaLabel="Select conversation"
            onChange={(conversationId) => void onConversationChange(conversationId)}
            options={conversationsInChannel.map((item) => ({
              label: `Conversation ${formatDate(item.lastMessageAt ?? item.createdAt)}`,
              value: item.id
            }))}
            value={selectedConversation.id}
          />
        ) : null}
      </nav>
      {!humanContactBlocked && conversationState.takeoverBriefing ? (
        <HumanTakeoverBriefing briefing={conversationState.takeoverBriefing} />
      ) : null}

      {!humanContactBlocked && isHumanConversation && (isEmailConversation || isWhatsAppConversation) ? (
        <section className="human-reply-panel" aria-label="Human reply">
          <header>
            <div>
              <p className="eyebrow">Human reply</p>
              <h3>{isEmailConversation && reviewDraft ? "Review suggested follow-up" : "Reply to customer"}</h3>
            </div>
            <StatusBadge tone="warm">Handled by you</StatusBadge>
          </header>
          {isEmailConversation && reviewDraft ? (
            <div className="follow-up-review-draft">
              <p>
                <strong>Why review is needed:</strong> {reviewDraft.reason}
              </p>
              <p>
                <strong>Subject:</strong> {reviewDraft.subject}
              </p>
              <p className="follow-up-review-body">{reviewDraft.body}</p>
              <Button
                variant="secondary"
                disabled={conversationState.saving}
                onClick={() => onHumanReplyInputChange(reviewDraft.body)}
                type="button"
              >
                <Pencil size={16} />
                Use suggested reply
              </Button>
            </div>
          ) : null}
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
            <Button
              variant="primary"
              disabled={
                conversationState.saving || conversationState.humanReplyInput.trim().length === 0
              }
              type="submit"
            >
              <Icon name="send" size={16} />
              {isWhatsAppConversation ? "Send WhatsApp reply" : reviewDraft ? "Send reviewed reply" : "Send human reply"}
            </Button>
          </form>
        </section>
      ) : null}

      <section className="conversation-thread" aria-label="Conversation thread">
        {conversationState.messages.length === 0 ? (
          <StateBlock title="No messages yet" />
        ) : (
          conversationState.messages.map((message) => (
            <article
              className={`message-bubble ${message.direction.toLowerCase()}`}
              key={message.id}
            >
              <span>{conversationSenderLabel(message)}</span>
              <p>{message.body}</p>
              {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                <ul className="message-attachments" aria-label="Attached media">
                  {message.attachments.map((attachment, index) => (
                    <li key={`${attachment.providerAttachmentId ?? attachment.fileName}-${String(index)}`}>
                      <ConversationAttachment accessToken={accessToken} conversationId={message.conversationId} messageId={message.id} index={index} attachment={attachment} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <small>
                {formatDate(message.createdAt)}
                {message.direction === "OUTBOUND"
                  ? ` · ${message.deliveryStatus === "PENDING" ? "Sending" : message.deliveryStatus === "FAILED" ? "Failed" : message.deliveryStatus === "DELIVERED" ? "Delivered" : message.deliveryStatus === "READ" ? "Read" : "Sent"}`
                  : ""}
              </small>
            </article>
          ))
        )}
      </section>

      {canUseAdvancedTestingTools ? (
        <details className="advanced-testing-tools">
          <summary>Advanced testing tools</summary>
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
            {!stoppedReason ? <Select
              ariaLabel="AI mode"
              onChange={(mode) => void onModeChange(mode as ConversationModeName)}
              options={CONVERSATION_MODES.map((mode) => ({
                label: mode.replaceAll("_", " "),
                value: mode
              }))}
              value={selectedConversation.mode}
            /> : null}
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
            {!stoppedReason ? <button
              disabled={conversationState.saving || isHumanOwned}
              onClick={() => void onRunCallingAttemptNowForE2E()}
              type="button"
            >
              <Icon name="send" size={16} />
              Test AI call
            </button> : null}
            {e2eAcceleratableSequenceId ? (
              <button
                disabled={conversationState.saving || isHumanOwned}
                onClick={() => void onAccelerateFollowUpForE2E(e2eAcceleratableSequenceId)}
                type="button"
              >
                <Icon name="sparkles" size={16} />
                Speed up test schedule
              </button>
            ) : null}
          </div>
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
          {!stoppedReason ? <form
            className="simulator-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void onSendProspectMessage();
            }}
          >
            <textarea
              aria-label="Prospect message"
              onChange={(event) => onConversationInputChange(event.target.value)}
              placeholder="Test message"
              rows={3}
              value={conversationState.input}
            />
            <button
              disabled={conversationState.saving || conversationState.input.trim().length === 0}
              type="submit"
            >
              <Icon name="send" size={16} />
              Save test message
            </button>
          </form> : null}
        </details>
      ) : null}
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
