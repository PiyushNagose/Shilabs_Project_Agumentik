import type {
  ActivityDto,
  CompanyDto,
  ContactDto,
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
  Plus,
  Search,
  Save,
  SlidersHorizontal,
  Sparkles,
  UserRound
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  completeTask,
  createContact,
  getLead,
  getLeadQualification,
  listLeadActivities,
  listLeads,
  listCompanies,
  listContacts,
  listMeetingRequests,
  listTasks
} from "../../services/api-client.js";
import { apiErrorMessage } from "../../services/api/core.js";
import { LeadQuickView, leadPriority } from "../leads/LeadExperience.js";
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
  return (
    typeof value === "string" && ["all", "hot", "follow-up", "unassigned", "recent"].includes(value)
  );
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
  companies: CompanyDto[];
  contacts: ContactDto[];
  leads: LeadDto[];
  tasks: TaskDto[];
}

interface ContactView {
  company: CompanyDto;
  contact: ContactDto;
  lead: LeadDto | null;
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date
  );
}

function segmentMatch(segment: SegmentId, lead: LeadDto): boolean {
  if (segment === "hot") return lead.temperature === "HOT";
  if (segment === "follow-up") return Boolean(lead.nextAction);
  if (segment === "unassigned") return lead.ownerId === null;
  if (segment === "recent") return isRecent(lead);
  return true;
}

function contactSegmentMatch(segment: SegmentId, view: ContactView): boolean {
  if (segment === "all") return true;
  if (!view.lead) return segment === "recent" && isRecentContact(view.contact);
  return segmentMatch(segment, view.lead);
}

function isRecentContact(contact: ContactDto): boolean {
  return new Date(contact.updatedAt).getTime() >= recentCutoff();
}

function ContactCreateForm({
  accessToken,
  companies,
  onCreated
}: {
  accessToken: string;
  companies: CompanyDto[];
  onCreated: () => Promise<void>;
}): React.JSX.Element {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("EMAIL");
  const [doNotContact, setDoNotContact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await createContact(accessToken, {
        companyId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        title: title.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        source: "Manual",
        preferredChannel,
        doNotContact
      });
      await onCreated();
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The contact could not be created."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="record-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="record-create-grid">
        <label className="record-create-wide">
          Company
          <Select
            ariaLabel="Contact company"
            onChange={setCompanyId}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            value={companyId}
          />
        </label>
        <label>
          First name
          <input
            autoFocus
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
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          Phone
          <input onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
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
        <label className="record-create-checkbox record-create-wide">
          <input
            checked={doNotContact}
            onChange={(event) => setDoNotContact(event.target.checked)}
            type="checkbox"
          />
          Do not contact
        </label>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <Button
          disabled={saving || !companyId || !firstName.trim() || !lastName.trim()}
          type="submit"
          variant="primary"
        >
          {saving ? "Creating..." : "Create contact"}
        </Button>
      </footer>
    </form>
  );
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
  const [createOpen, setCreateOpen] = useState(false);

  const resource = usePersistedResource<ContactWorkspaceData>({
    scope: `lead-contacts:${accessToken}`,
    load: async () => {
      const [page, tasks, contacts, companies] = await Promise.all([
        listLeads(accessToken, {
          page: 1,
          pageSize: 100,
          sort: "lastActivityAt",
          direction: "desc"
        }),
        listTasks(accessToken, {}),
        listContacts(accessToken),
        listCompanies(accessToken)
      ]);
      return { companies, contacts, leads: page.items, tasks };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["workspace", "company", "contact", "lead", "task", "activity"].includes(
        event.entityType
      ),
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
  const companies = resource.data?.companies ?? [];
  const contacts = resource.data?.contacts ?? [];
  const tasks = resource.data?.tasks ?? [];
  const owners = useMemo(() => {
    const unique = new Map<string, NonNullable<LeadDto["owner"]>>();
    for (const lead of leads) if (lead.owner) unique.set(lead.owner.id, lead.owner);
    return [...unique.values()].sort((a, b) => a.firstName.localeCompare(b.firstName));
  }, [leads]);
  const contactViews = useMemo<ContactView[]>(() => {
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const leadByContactId = new Map(leads.map((lead) => [lead.contactId, lead]));
    return contacts.flatMap((contact) => {
      const company = companyById.get(contact.companyId);
      return company ? [{ company, contact, lead: leadByContactId.get(contact.id) ?? null }] : [];
    });
  }, [companies, contacts, leads]);
  const visibleContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return contactViews
      .filter((view) => contactSegmentMatch(segment, view))
      .filter((view) => !ownerId || view.lead?.ownerId === ownerId)
      .filter((view) => {
        if (!query) return true;
        return [
          `${view.contact.firstName} ${view.contact.lastName}`,
          view.company.name,
          view.contact.email,
          view.contact.phone,
          view.contact.title,
          view.lead?.requirement,
          view.lead?.serviceInterest
        ].some((value) => value?.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (sort === "score") return (right.lead?.score ?? -1) - (left.lead?.score ?? -1);
        if (sort === "name")
          return `${left.contact.firstName} ${left.contact.lastName}`.localeCompare(
            `${right.contact.firstName} ${right.contact.lastName}`
          );
        return (
          new Date(right.lead?.lastActivityAt ?? right.contact.updatedAt).getTime() -
          new Date(left.lead?.lastActivityAt ?? left.contact.updatedAt).getTime()
        );
      });
  }, [contactViews, ownerId, search, segment, sort]);

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
              <strong>
                {contactViews.filter((view) => contactSegmentMatch(item.id, view)).length}
              </strong>
            </button>
          ))}
        </nav>
        <span className="records-eyebrow saved-view-label">Saved view</span>
        {savedView ? (
          <button className="saved-view-button" onClick={applySavedView} type="button">
            <Bookmark size={15} />
            <span>My contact view</span>
          </button>
        ) : null}
        <Button onClick={saveCurrentView} size="sm" variant="ghost">
          <Save size={15} /> Save current view
        </Button>
        <div className="saved-filter-note">
          <Sparkles size={16} />
          <span>
            <strong>Live segments</strong>Update from persisted CRM activity.
          </span>
        </div>
      </aside>

      <div className="records-main">
        <header className="records-heading">
          <div>
            <span className="records-eyebrow">CRM / Contacts</span>
            <h2>Lead contacts</h2>
            <p>{visibleContacts.length} authorized records</p>
          </div>
          <Button
            disabled={companies.length === 0}
            onClick={() => setCreateOpen(true)}
            variant="primary"
          >
            <Plus size={17} /> New contact
          </Button>
        </header>
        <div className="records-toolbar">
          <label className="records-search">
            <Search size={17} />
            <input
              aria-label="Search lead contacts"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search people, company or intent"
              type="search"
              value={search}
            />
          </label>
          <Select
            ariaLabel="Filter contacts by owner"
            className="records-filter"
            icon={<UserRound size={16} />}
            onChange={setOwnerId}
            options={[
              { value: "", label: "All owners" },
              ...owners.map((owner) => ({
                value: owner.id,
                label: `${owner.firstName} ${owner.lastName}`
              }))
            ]}
            value={ownerId}
          />
          <Select
            ariaLabel="Sort lead contacts"
            className="records-filter"
            icon={<SlidersHorizontal size={16} />}
            onChange={(value) => setSort(value as SortId)}
            options={[
              { value: "activity", label: "Latest activity" },
              { value: "score", label: "Highest score" },
              { value: "name", label: "Name" }
            ]}
            value={sort}
          />
        </div>

        {resource.loading && !resource.data ? (
          <StateBlock
            title="Loading lead contacts"
            detail="Fetching authorized lead and engagement records."
          />
        ) : null}
        {resource.error && !resource.data ? (
          <StateBlock
            title="Lead contacts unavailable"
            detail={resource.error}
            action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          />
        ) : null}
        {!resource.loading && !resource.error && visibleContacts.length === 0 ? (
          <StateBlock
            title="No matching contacts"
            detail="Try another segment or clear the search filters."
          />
        ) : null}

        {visibleContacts.length > 0 ? (
          <div className="lead-contact-stack">
            {visibleContacts.map(({ company, contact, lead }) => {
              const priority = lead
                ? leadPriority(tasks.filter((task) => task.leadId === lead.id))
                : "NONE";
              const name = `${contact.firstName} ${contact.lastName}`;
              return (
                <article className="lead-contact-card" key={contact.id}>
                  <div className="contact-card-profile">
                    <span className="lead-avatar" aria-hidden="true">
                      {contact.firstName.slice(0, 1)}
                      {contact.lastName.slice(0, 1)}
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <p>{contact.title ?? company.name}</p>
                      <small>{contact.email ?? "No email"}</small>
                    </div>
                  </div>
                  <div className="contact-card-context">
                    <span>Company</span>
                    <strong>{company.name}</strong>
                    <p>{lead?.requirement ?? lead?.serviceInterest ?? "No lead linked"}</p>
                  </div>
                  <div className="contact-card-engagement">
                    <span>
                      <Clock3 size={14} /> Last engagement
                    </span>
                    <strong>{formatDate(lead?.lastActivityAt ?? contact.updatedAt)}</strong>
                    <p>{lead?.nextAction ?? "No next action"}</p>
                  </div>
                  <div className="contact-card-score">
                    <strong>{lead?.score ?? "-"}</strong>
                    <span>{lead?.temperature ?? "CONTACT"}</span>
                    <Badge
                      tone={priority === "HIGH" || priority === "URGENT" ? "danger" : "neutral"}
                    >
                      {priority === "NONE" ? "No task" : priority}
                    </Badge>
                  </div>
                  <div className="contact-card-footer">
                    <div className="contact-quick-actions">
                      {contact.phone ? (
                        <a aria-label={`Call ${name}`} href={`tel:${contact.phone}`}>
                          <Phone size={16} />
                        </a>
                      ) : null}
                      {contact.email ? (
                        <a aria-label={`Email ${name}`} href={`mailto:${contact.email}`}>
                          <Mail size={16} />
                        </a>
                      ) : null}
                      {lead ? (
                        <button
                          aria-label={`Preview ${name}`}
                          onClick={() => setSelectedLeadId(lead.id)}
                          type="button"
                        >
                          <Eye size={16} />
                        </button>
                      ) : null}
                    </div>
                    {lead ? (
                      <Button
                        onClick={() => onOpenLead(lead.id, "Overview")}
                        size="sm"
                        variant="ghost"
                      >
                        Open profile <ArrowUpRight size={15} />
                      </Button>
                    ) : (
                      <Badge tone={contact.doNotContact ? "warning" : "neutral"}>
                        {contact.doNotContact ? "Do not contact" : "Contact only"}
                      </Badge>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New contact">
        <ContactCreateForm
          accessToken={accessToken}
          companies={companies}
          onCreated={async () => {
            await resource.reload();
            setCreateOpen(false);
          }}
        />
      </Modal>

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
