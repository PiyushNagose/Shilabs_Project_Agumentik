import type { ActivityDto, CompanyDto, ContactDto, DealDto, LeadDto } from "@shilabs/shared-types";
import {
  ArrowUpRight,
  Building2,
  ExternalLink,
  Grid2X2,
  List,
  Mail,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Drawer, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  createCompany,
  listCompanies,
  listContacts,
  listDeals,
  listLeadActivities,
  listAllLeads
} from "../../services/api-client.js";
import { apiErrorMessage } from "../../services/api/core.js";
import { LeadTimeline, leadName } from "../leads/LeadExperience.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";

type CompanyMode = "grid" | "list";
type CompanySort = "recent" | "name" | "activity" | "contacts";

interface CompaniesData {
  companies: CompanyDto[];
  contacts: ContactDto[];
  leads: LeadDto[];
  deals: DealDto[];
}

interface CompanyDetailData {
  company: CompanyDto;
  contacts: ContactDto[];
  leads: LeadDto[];
  activities: ActivityDto[];
}

function companyStatus(leads: LeadDto[]): "ACTIVE" | "DORMANT" {
  return leads.some((lead) => lead.status === "OPEN" || lead.status === "NURTURE")
    ? "ACTIVE"
    : "DORMANT";
}

function companyOwners(leads: LeadDto[]): NonNullable<LeadDto["owner"]>[] {
  const owners = new Map<string, NonNullable<LeadDto["owner"]>>();
  for (const lead of leads) if (lead.owner) owners.set(lead.owner.id, lead.owner);
  return [...owners.values()];
}

export function companyPipelineValue(deals: Pick<DealDto, "status" | "currency" | "value">[]): string {
  const open = deals.filter((deal) => deal.status === "OPEN");
  if (open.length === 0) return "No open deals";
  const totals = new Map<string, number>();
  for (const deal of open) {
    if (deal.value !== null) totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + Number(deal.value));
  }
  if (totals.size === 0) return "Value not set";
  return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, value]) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value)
  ).join(", ");
}

async function listOpenCompanyDeals(accessToken: string): Promise<DealDto[]> {
  const first = await listDeals(accessToken, { status: "OPEN", page: 1, pageSize: 100 });
  const remaining = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
    listDeals(accessToken, { status: "OPEN", page: index + 2, pageSize: 100 })
  ));
  return [first.items, ...remaining.map((page) => page.items)].flat();
}

function websiteHref(company: CompanyDto): string | null {
  if (!company.website) return null;
  return /^https?:\/\//iu.test(company.website) ? company.website : `https://${company.website}`;
}

function CompanyCreateForm({
  accessToken,
  onCreated
}: {
  accessToken: string;
  onCreated: () => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [employeeRange, setEmployeeRange] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await createCompany(accessToken, {
        name: name.trim(),
        website: website.trim() || null,
        industry: industry.trim() || null,
        location: location.trim() || null,
        employeeRange: employeeRange.trim() || null,
        notes: notes.trim() || null
      });
      await onCreated();
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The company could not be created."));
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
        <label>
          Company name
          <input
            autoFocus
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
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
        <label>
          Industry
          <input
            onChange={(event) => setIndustry(event.target.value)}
            placeholder="Technology"
            value={industry}
          />
        </label>
        <label>
          Location
          <input
            onChange={(event) => setLocation(event.target.value)}
            placeholder="City, country"
            value={location}
          />
        </label>
        <label>
          Company size
          <input
            onChange={(event) => setEmployeeRange(event.target.value)}
            placeholder="51-200"
            value={employeeRange}
          />
        </label>
        <label className="record-create-wide">
          Notes
          <textarea
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            value={notes}
          />
        </label>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <Button disabled={saving || !name.trim()} type="submit" variant="primary">
          {saving ? "Creating..." : "Create company"}
        </Button>
      </footer>
    </form>
  );
}

export function CompaniesWorkspace({
  accessToken,
  onOpenLead
}: {
  accessToken: string;
  onOpenLead: (leadId: string | null, tab?: DetailTab) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<CompanySort>("recent");
  const [mode, setMode] = useState<CompanyMode>("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const resource = usePersistedResource<CompaniesData>({
    scope: `companies:${accessToken}`,
    load: async () => {
      const [companies, contacts, leads, deals] = await Promise.all([
        listCompanies(accessToken),
        listContacts(accessToken),
        listAllLeads(accessToken, {
          sort: "lastActivityAt",
          direction: "desc"
        }),
        listOpenCompanyDeals(accessToken)
      ]);
      return { companies, contacts, leads, deals };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["workspace", "company", "contact", "lead", "activity", "deal", "pipeline"].includes(event.entityType),
    errorMessage: "Companies could not be loaded"
  });

  const detail = usePersistedResource<CompanyDetailData | null>({
    scope: `company-detail:${accessToken}:${selectedCompanyId ?? "closed"}`,
    load: async () => {
      if (!selectedCompanyId || !resource.data) return null;
      const company = resource.data.companies.find((item) => item.id === selectedCompanyId);
      if (!company) return null;
      const leads = resource.data.leads.filter((lead) => lead.companyId === company.id);
      const contacts = resource.data.contacts.filter((contact) => contact.companyId === company.id);
      const activityGroups = await Promise.all(
        leads.map((lead) => listLeadActivities(accessToken, lead.id))
      );
      const activities = activityGroups
        .flat()
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
        );
      return { company, contacts, leads, activities };
    },
    accepts: (event) => {
      if (!selectedCompanyId) return false;
      if (
        event.type === "realtime:reconnected" ||
        ["workspace", "company", "contact"].includes(event.entityType)
      )
        return true;
      const relatedLeadIds =
        resource.data?.leads
          .filter((lead) => lead.companyId === selectedCompanyId)
          .map((lead) => lead.id) ?? [];
      return Boolean(event.leadId && relatedLeadIds.includes(event.leadId));
    },
    errorMessage: "Company details could not be loaded"
  });

  const data = resource.data ?? { companies: [], contacts: [], leads: [], deals: [] };
  const industries = useMemo(
    () =>
      [
        ...new Set(
          data.companies
            .map((company) => company.industry)
            .filter((value): value is string => Boolean(value))
        )
      ].sort(),
    [data.companies]
  );
  const visibleCompanies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return data.companies
      .filter((company) => !industry || company.industry === industry)
      .filter((company) => {
        const leads = data.leads.filter((lead) => lead.companyId === company.id);
        return !status || companyStatus(leads) === status;
      })
      .filter(
        (company) =>
          !query ||
          [company.name, company.website, company.industry, company.location].some((value) =>
            value?.toLocaleLowerCase().includes(query)
          )
      )
      .sort((left, right) => {
        if (sort === "recent") {
          return (
            Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id)
          );
        }
        if (sort === "contacts") {
          return (
            data.contacts.filter((contact) => contact.companyId === right.id).length -
            data.contacts.filter((contact) => contact.companyId === left.id).length
          );
        }
        if (sort === "activity") {
          const latest = (companyId: string): number =>
            Math.max(
              0,
              ...data.leads
                .filter((lead) => lead.companyId === companyId)
                .map((lead) => new Date(lead.lastActivityAt ?? 0).getTime())
            );
          return latest(right.id) - latest(left.id);
        }
        return left.name.localeCompare(right.name);
      });
  }, [data.companies, data.contacts, data.leads, industry, search, sort, status]);

  return (
    <section className="records-workspace companies-workspace" aria-label="Companies workspace">
      <div className="records-main">
        <header className="records-heading companies-heading">
          <div>
            <span className="records-eyebrow">CRM / Accounts</span>
            <h2>Companies</h2>
              <p>{resource.data ? `${String(visibleCompanies.length)} authorized accounts` : resource.loading ? "Loading companies..." : "Company count unavailable"}</p>
          </div>
          <div className="records-heading-actions">
            <div className="view-toggle" aria-label="Company view">
              <button
                aria-label="Grid view"
                aria-pressed={mode === "grid"}
                className={mode === "grid" ? "active" : ""}
                onClick={() => setMode("grid")}
                type="button"
              >
                <Grid2X2 size={17} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={mode === "list"}
                className={mode === "list" ? "active" : ""}
                onClick={() => setMode("list")}
                type="button"
              >
                <List size={17} />
              </button>
            </div>
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              <Plus size={17} /> New company
            </Button>
          </div>
        </header>
        <div className="records-toolbar company-toolbar">
          <label className="records-search">
            <Search size={17} />
            <input
              aria-label="Search companies"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search company, website or location"
              type="search"
              value={search}
            />
          </label>
          <Select
            ariaLabel="Filter companies by industry"
            className="records-filter"
            icon={<Building2 size={16} />}
            onChange={setIndustry}
            options={[
              { value: "", label: "All industries" },
              ...industries.map((item) => ({ value: item, label: item }))
            ]}
            value={industry}
          />
          <Select
            ariaLabel="Filter companies by status"
            className="records-filter"
            icon={<UsersRound size={16} />}
            onChange={setStatus}
            options={[
              { value: "", label: "All statuses" },
              { value: "ACTIVE", label: "Active" },
              { value: "DORMANT", label: "Dormant" }
            ]}
            value={status}
          />
          <Select
            ariaLabel="Sort companies"
            className="records-filter"
            icon={<SlidersHorizontal size={16} />}
            onChange={(value) => setSort(value as CompanySort)}
            options={[
              { value: "recent", label: "Newest first" },
              { value: "name", label: "Company name" },
              { value: "activity", label: "Latest activity" },
              { value: "contacts", label: "Most contacts" }
            ]}
            value={sort}
          />
        </div>

        {resource.loading && !resource.data ? (
          <StateBlock
            title="Loading companies"
            detail="Fetching authorized accounts and relationships."
          />
        ) : null}
        {resource.error && !resource.data ? (
          <StateBlock
            title="Companies unavailable"
            detail={resource.error}
            action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          />
        ) : null}
        {!resource.loading && !resource.error && visibleCompanies.length === 0 ? (
          <StateBlock
            title="No matching companies"
            detail="Try changing the search or account filters."
          />
        ) : null}

        {visibleCompanies.length > 0 ? (
          <div className={`company-collection ${mode}`}>
            {visibleCompanies.map((company) => {
              const contacts = data.contacts.filter((contact) => contact.companyId === company.id);
              const leads = data.leads.filter((lead) => lead.companyId === company.id);
              const owners = companyOwners(leads);
              const href = websiteHref(company);
              const accountStatus = companyStatus(leads);
              return (
                <article className="company-card" key={company.id}>
                  <header>
                    <span className="company-mark" aria-hidden="true">
                      {company.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3>{company.name}</h3>
                      <p>{company.industry ?? "Industry not set"}</p>
                    </div>
                    <Badge tone={accountStatus === "ACTIVE" ? "success" : "neutral"}>
                      {accountStatus}
                    </Badge>
                  </header>
                  <dl className="company-facts">
                    <div>
                      <dt>Location</dt>
                      <dd>{company.location ?? "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Company size</dt>
                      <dd>{company.employeeRange ?? "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Contacts</dt>
                      <dd>{contacts.length}</dd>
                    </div>
                    <div>
                      <dt>Open pipeline</dt>
                      <dd>{companyPipelineValue(data.deals.filter((deal) => deal.lead.companyId === company.id))}</dd>
                    </div>
                  </dl>
                  <div className="company-owners">
                    <span>Owners</span>
                    <div className="avatar-stack">
                      {owners.length ? (
                        owners.slice(0, 4).map((owner) => (
                          <span key={owner.id} title={`${owner.firstName} ${owner.lastName}`}>
                            {owner.firstName.slice(0, 1)}
                            {owner.lastName.slice(0, 1)}
                          </span>
                        ))
                      ) : (
                        <small>Unassigned</small>
                      )}
                    </div>
                  </div>
                  <footer>
                    <div className="contact-quick-actions">
                      {href ? (
                        <a
                          aria-label={`Open ${company.name} website`}
                          href={href}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={16} />
                        </a>
                      ) : null}
                      {contacts[0]?.email ? (
                        <a
                          aria-label={`Email ${company.name}`}
                          href={`mailto:${contacts[0].email}`}
                        >
                          <Mail size={16} />
                        </a>
                      ) : null}
                    </div>
                    <Button
                      onClick={() => setSelectedCompanyId(company.id)}
                      size="sm"
                      variant="ghost"
                    >
                      View account <ArrowUpRight size={15} />
                    </Button>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New company">
        <CompanyCreateForm
          accessToken={accessToken}
          onCreated={async () => {
            await resource.reload();
            setCreateOpen(false);
          }}
        />
      </Modal>

      <Drawer
        open={selectedCompanyId !== null}
        onClose={() => setSelectedCompanyId(null)}
        title="Company details"
        footer={
          detail.data?.leads[0] ? (
            <Button
              onClick={() => {
                const lead = detail.data?.leads[0];
                if (lead) onOpenLead(lead.id, "Overview");
              }}
            >
              Open primary lead <ArrowUpRight size={15} />
            </Button>
          ) : undefined
        }
      >
        {detail.loading && !detail.data ? (
          <StateBlock
            title="Loading company"
            detail="Fetching linked contacts, leads and activity."
          />
        ) : null}
        {detail.error && !detail.data ? (
          <StateBlock
            title="Company unavailable"
            detail={detail.error}
            action={<Button onClick={() => void detail.reload()}>Retry</Button>}
          />
        ) : null}
        {detail.data ? (
          <div className="company-drawer">
            <header>
              <span className="company-mark" aria-hidden="true">
                {detail.data.company.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h3>{detail.data.company.name}</h3>
                <p>{detail.data.company.industry ?? "Industry not set"}</p>
              </div>
            </header>
            <div className="company-drawer-facts">
              <span>
                <MapPin size={15} />
                {detail.data.company.location ?? "Location not set"}
              </span>
              <span>
                <UsersRound size={15} />
                {detail.data.company.employeeRange ?? "Size not set"}
              </span>
              {websiteHref(detail.data.company) ? (
                <a
                  href={websiteHref(detail.data.company) ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={15} />
                  {detail.data.company.website}
                </a>
              ) : null}
            </div>
            <section>
              <header>
                <h4>Contacts</h4>
                <Badge>{detail.data.contacts.length}</Badge>
              </header>
              {detail.data.contacts.length ? (
                <div className="company-related-list">
                  {detail.data.contacts.map((contact) => (
                    <article key={contact.id}>
                      <div>
                        <strong>
                          {contact.firstName} {contact.lastName}
                        </strong>
                        <span>{contact.title ?? "Title not set"}</span>
                      </div>
                      {contact.email ? (
                        <a
                          aria-label={`Email ${contact.firstName} ${contact.lastName}`}
                          href={`mailto:${contact.email}`}
                        >
                          <Mail size={15} />
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="records-muted">No linked contacts.</p>
              )}
            </section>
            <section>
              <header>
                <h4>Leads and deals</h4>
                <Badge>{detail.data.leads.length}</Badge>
              </header>
              {detail.data.leads.length ? (
                <div className="company-related-list">
                  {detail.data.leads.map((lead) => (
                    <article key={lead.id}>
                      <div>
                        <strong>{leadName(lead)}</strong>
                        <span>
                          {lead.stage.label} / {lead.status}
                        </span>
                      </div>
                      <div>
                        <Button
                          onClick={() => onOpenLead(lead.id, "Overview")}
                          size="sm"
                          variant="ghost"
                        >
                          Lead
                        </Button>
                        <Button
                          onClick={() => onOpenLead(lead.id, "Deal")}
                          size="sm"
                          variant="ghost"
                        >
                          Deal
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="records-muted">No linked leads or deal context.</p>
              )}
            </section>
            <section>
              <header>
                <h4>Recent activity</h4>
                <Badge>{detail.data.activities.length}</Badge>
              </header>
              <LeadTimeline activities={detail.data.activities.slice(0, 8)} />
            </section>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}
