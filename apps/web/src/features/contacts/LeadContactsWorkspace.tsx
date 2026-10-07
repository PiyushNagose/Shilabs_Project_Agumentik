import type {
  ActivityDto,
  LeadDto,
  LeadQualificationDto,
  MeetingRequestDto,
  TaskDto
} from "@shilabs/shared-types";
import {
  ArrowUpRight,
  Bookmark,
  Clock3,
  Eye,
  Mail,
  Phone,
  Search,
  Save,
  SlidersHorizontal,
  Sparkles,
  UserRound
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  completeTask,
  getLead,
  getLeadQualification,
  listLeadActivities,
  listLeads,
  listMeetingRequests,
  listTasks
} from "../../services/api-client.js";
import { LeadQuickView, leadName, leadPriority } from "../leads/LeadExperience.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";

type SegmentId = "all" | "hot" | "follow-up" | "unassigned" | "recent";
type SortId = "activity" | "score" | "name";

interface SavedContactView {
  ownerId: string;
  search: string;
  segment: SegmentId;
  sort: SortId;
}

const savedViewKey = "shilabs.lead-contacts.saved-view";

function isSegmentId(value: unknown): value is SegmentId {
  return typeof value === "string" && ["all", "hot", "follow-up", "unassigned", "recent"].includes(value);
}

function isSortId(value: unknown): value is SortId {
  return typeof value === "string" && ["activity", "score", "name"].includes(value);
}

function readSavedView(): SavedContactView | null {
  try {
    const value = window.localStorage.getItem(savedViewKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SavedContactView>;
    if (!isSegmentId(parsed.segment) || !isSortId(parsed.sort)) return null;
    return {
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : "",
      search: typeof parsed.search === "string" ? parsed.search : "",
      segment: parsed.segment,
      sort: parsed.sort
    };
  } catch {
    return null;
  }
}

interface ContactWorkspaceData {
  leads: LeadDto[];
  tasks: TaskDto[];
}

interface LeadDrawerData {
  lead: LeadDto;
  activities: ActivityDto[];
  qualification: LeadQualificationDto | null;
  tasks: TaskDto[];
  meetings: MeetingRequestDto[];
}

function recentCutoff(): number {
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

function isRecent(lead: LeadDto): boolean {
  return lead.lastActivityAt !== null && new Date(lead.lastActivityAt).getTime() >= recentCutoff();
}

function formatDate(value: string | null): string {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function segmentMatch(segment: SegmentId, lead: LeadDto): boolean {
  if (segment === "hot") return lead.temperature === "HOT";
  if (segment === "follow-up") return Boolean(lead.nextAction);
  if (segment === "unassigned") return lead.ownerId === null;
  if (segment === "recent") return isRecent(lead);
  return true;
}

export function LeadContactsWorkspace({
  accessToken,
  onOpenLead
}: {
  accessToken: string;
  onOpenLead: (leadId: string | null, tab?: DetailTab) => void;
}): React.JSX.Element {
  const [segment, setSegment] = useState<SegmentId>("all");
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [sort, setSort] = useState<SortId>("activity");
  const [savedView, setSavedView] = useState<SavedContactView | null>(() => readSavedView());
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const resource = usePersistedResource<ContactWorkspaceData>({
    scope: `lead-contacts:${accessToken}`,
    load: async () => {
      const [page, tasks] = await Promise.all([
        listLeads(accessToken, { page: 1, pageSize: 100, sort: "lastActivityAt", direction: "desc" }),
        listTasks(accessToken, {})
      ]);
      return { leads: page.items, tasks };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["workspace", "lead", "task", "activity"].includes(event.entityType),
    errorMessage: "Lead contacts could not be loaded"
  });

  const drawer = usePersistedResource<LeadDrawerData | null>({
    scope: `lead-contact-drawer:${accessToken}:${selectedLeadId ?? "closed"}`,
    load: async () => {
      if (!selectedLeadId) return null;
      const [lead, activities, qualification, tasks, meetings] = await Promise.all([
        getLead(accessToken, selectedLeadId),
        listLeadActivities(accessToken, selectedLeadId),
        getLeadQualification(accessToken, selectedLeadId).catch(() => null),
        listTasks(accessToken, { leadId: selectedLeadId }),
        listMeetingRequests(accessToken, { leadId: selectedLeadId, limit: 50 })
      ]);
      return { lead, activities, qualification, tasks, meetings };
    },
    accepts: (event) =>
      selectedLeadId !== null &&
      (event.type === "realtime:reconnected" ||
        event.entityType === "workspace" ||
        event.leadId === selectedLeadId),
    errorMessage: "Lead details could not be loaded"
  });

  const leads = resource.data?.leads ?? [];
  const tasks = resource.data?.tasks ?? [];
  const owners = useMemo(() => {
    const unique = new Map<string, NonNullable<LeadDto["owner"]>>();
    for (const lead of leads) if (lead.owner) unique.set(lead.owner.id, lead.owner);
    return [...unique.values()].sort((a, b) => a.firstName.localeCompare(b.firstName));
  }, [leads]);
  const visibleLeads = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return leads
      .filter((lead) => segmentMatch(segment, lead))
      .filter((lead) => !ownerId || lead.ownerId === ownerId)
      .filter((lead) => {
        if (!query) return true;
        return [leadName(lead), lead.company.name, lead.contact.email, lead.requirement, lead.serviceInterest]
          .some((value) => value?.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (sort === "score") return right.score - left.score;
        if (sort === "name") return leadName(left).localeCompare(leadName(right));
        return new Date(right.lastActivityAt ?? 0).getTime() - new Date(left.lastActivityAt ?? 0).getTime();
      });
  }, [leads, ownerId, search, segment, sort]);

  const segments: { id: SegmentId; label: string }[] = [
    { id: "all", label: "All contacts" },
    { id: "hot", label: "High priority" },
    { id: "follow-up", label: "Needs follow-up" },
    { id: "unassigned", label: "Unassigned" },
    { id: "recent", label: "Recently active" }
  ];

  async function markTaskComplete(taskId: string): Promise<void> {
    await completeTask(accessToken, taskId);
    await Promise.all([resource.reload(), drawer.reload()]);
  }

  function saveCurrentView(): void {
    const view = { ownerId, search, segment, sort };
    window.localStorage.setItem(savedViewKey, JSON.stringify(view));
    setSavedView(view);
  }

  function applySavedView(): void {
    if (!savedView) return;
    setOwnerId(savedView.ownerId);
    setSearch(savedView.search);
    setSegment(savedView.segment);
    setSort(savedView.sort);
  }

  return (
    <section className="records-workspace contacts-workspace" aria-label="Lead contacts workspace">
      <aside className="records-segments" aria-label="Lead contact filters">
        <span className="records-eyebrow">System filters</span>
        <nav>
          {segments.map((item) => (
            <button
              aria-pressed={segment === item.id}
              className={segment === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setSegment(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <strong>{leads.filter((lead) => segmentMatch(item.id, lead)).length}</strong>
            </button>
          ))}
        </nav>
        <span className="records-eyebrow saved-view-label">Saved view</span>
        {savedView ? <button className="saved-view-button" onClick={applySavedView} type="button"><Bookmark size={15} /><span>My contact view</span></button> : null}
        <Button onClick={saveCurrentView} size="sm" variant="ghost"><Save size={15} /> Save current view</Button>
        <div className="saved-filter-note">
          <Sparkles size={16} />
          <span><strong>Live segments</strong>Update from persisted CRM activity.</span>
        </div>
      </aside>

      <div className="records-main">
        <header className="records-heading">
          <div><span className="records-eyebrow">CRM / Contacts</span><h2>Lead contacts</h2><p>{visibleLeads.length} authorized records</p></div>
        </header>
        <div className="records-toolbar">
          <label className="records-search"><Search size={17} /><input aria-label="Search lead contacts" onChange={(event) => setSearch(event.target.value)} placeholder="Search people, company or intent" type="search" value={search} /></label>
          <label><UserRound size={16} /><select aria-label="Filter contacts by owner" onChange={(event) => setOwnerId(event.target.value)} value={ownerId}><option value="">All owners</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select></label>
          <label><SlidersHorizontal size={16} /><select aria-label="Sort lead contacts" onChange={(event) => setSort(event.target.value as SortId)} value={sort}><option value="activity">Latest activity</option><option value="score">Highest score</option><option value="name">Name</option></select></label>
        </div>

        {resource.loading && !resource.data ? <StateBlock title="Loading lead contacts" detail="Fetching authorized lead and engagement records." /> : null}
        {resource.error && !resource.data ? <StateBlock title="Lead contacts unavailable" detail={resource.error} action={<Button onClick={() => void resource.reload()}>Retry</Button>} /> : null}
        {!resource.loading && !resource.error && visibleLeads.length === 0 ? <StateBlock title="No matching contacts" detail="Try another segment or clear the search filters." /> : null}

        {visibleLeads.length > 0 ? <div className="lead-contact-stack">
          {visibleLeads.map((lead) => {
            const priority = leadPriority(tasks.filter((task) => task.leadId === lead.id));
            return <article className="lead-contact-card" key={lead.id}>
              <div className="contact-card-profile">
                <span className="lead-avatar" aria-hidden="true">{lead.contact.firstName.slice(0, 1)}{lead.contact.lastName.slice(0, 1)}</span>
                <div><h3>{leadName(lead)}</h3><p>{lead.contact.title ?? lead.company.name}</p><small>{lead.contact.email ?? "No email"}</small></div>
              </div>
              <div className="contact-card-context">
                <span>Company</span><strong>{lead.company.name}</strong><p>{lead.requirement ?? lead.serviceInterest ?? "Intent not identified"}</p>
              </div>
              <div className="contact-card-engagement">
                <span><Clock3 size={14} /> Last engagement</span><strong>{formatDate(lead.lastActivityAt)}</strong><p>{lead.nextAction ?? "No next action"}</p>
              </div>
              <div className="contact-card-score"><strong>{lead.score}</strong><span>{lead.temperature}</span><Badge tone={priority === "HIGH" || priority === "URGENT" ? "danger" : "neutral"}>{priority === "NONE" ? "No task" : priority}</Badge></div>
              <div className="contact-card-footer">
                <div className="contact-quick-actions">
                  {lead.contact.phone ? <a aria-label={`Call ${leadName(lead)}`} href={`tel:${lead.contact.phone}`}><Phone size={16} /></a> : null}
                  {lead.contact.email ? <a aria-label={`Email ${leadName(lead)}`} href={`mailto:${lead.contact.email}`}><Mail size={16} /></a> : null}
                  <button aria-label={`Preview ${leadName(lead)}`} onClick={() => setSelectedLeadId(lead.id)} type="button"><Eye size={16} /></button>
                </div>
                <Button onClick={() => onOpenLead(lead.id, "Overview")} size="sm" variant="ghost">Open profile <ArrowUpRight size={15} /></Button>
              </div>
            </article>;
          })}
        </div> : null}
      </div>

      <LeadQuickView
        activities={drawer.data?.activities ?? []}
        lead={drawer.data?.lead ?? null}
        qualification={drawer.data?.qualification ?? null}
        tasks={drawer.data?.tasks ?? []}
        tasksLoading={drawer.loading}
        tasksError={drawer.error}
        meetings={drawer.data?.meetings ?? []}
        open={selectedLeadId !== null}
        onClose={() => setSelectedLeadId(null)}
        onCompleteTask={markTaskComplete}
        onOpenProfile={() => selectedLeadId && onOpenLead(selectedLeadId, "Overview")}
      />
    </section>
  );
}
