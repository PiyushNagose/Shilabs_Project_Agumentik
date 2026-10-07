import type { ActivityDto, CompanyDto, ContactDto, LeadDto } from "@shilabs/shared-types";
import {
  ArrowUpRight,
  Building2,
  ExternalLink,
  Grid2X2,
  List,
  Mail,
  MapPin,
  Search,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Drawer } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  listCompanies,
  listContacts,
  listLeadActivities,
  listLeads
} from "../../services/api-client.js";
import { LeadTimeline, leadName } from "../leads/LeadExperience.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";

type CompanyMode = "grid" | "list";
type CompanySort = "name" | "activity" | "contacts";

interface CompaniesData {
  companies: CompanyDto[];
  contacts: ContactDto[];
  leads: LeadDto[];
}

interface CompanyDetailData {
  company: CompanyDto;
  contacts: ContactDto[];
  leads: LeadDto[];
  activities: ActivityDto[];
}

function companyStatus(leads: LeadDto[]): "ACTIVE" | "DORMANT" {
  return leads.some((lead) => lead.status === "OPEN" || lead.status === "NURTURE") ? "ACTIVE" : "DORMANT";
}

function companyOwners(leads: LeadDto[]): NonNullable<LeadDto["owner"]>[] {
  const owners = new Map<string, NonNullable<LeadDto["owner"]>>();
  for (const lead of leads) if (lead.owner) owners.set(lead.owner.id, lead.owner);
  return [...owners.values()];
}

function pipelineValue(leads: LeadDto[]): string {
  const total = leads.reduce((sum, lead) => sum + Number(lead.estimatedValue ?? 0), 0);
  if (total === 0) return "Not set";
  const currency = leads.find((lead) => lead.estimatedValue)?.currency ?? "USD";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(total);
}

function websiteHref(company: CompanyDto): string | null {
  if (!company.website) return null;
  return /^https?:\/\//iu.test(company.website) ? company.website : `https://${company.website}`;
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
  const [sort, setSort] = useState<CompanySort>("name");
  const [mode, setMode] = useState<CompanyMode>("grid");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const resource = usePersistedResource<CompaniesData>({
    scope: `companies:${accessToken}`,
    load: async () => {
      const [companies, contacts, leadPage] = await Promise.all([
        listCompanies(accessToken),
        listContacts(accessToken),
        listLeads(accessToken, { page: 1, pageSize: 100, sort: "lastActivityAt", direction: "desc" })
      ]);
      return { companies, contacts, leads: leadPage.items };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["workspace", "lead", "activity"].includes(event.entityType),
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
      const activityGroups = await Promise.all(leads.map((lead) => listLeadActivities(accessToken, lead.id)));
      const activities = activityGroups.flat().sort((left, right) =>
        new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      );
      return { company, contacts, leads, activities };
    },
    accepts: (event) => {
      if (!selectedCompanyId) return false;
      if (event.type === "realtime:reconnected" || event.entityType === "workspace") return true;
      const relatedLeadIds = resource.data?.leads
        .filter((lead) => lead.companyId === selectedCompanyId)
        .map((lead) => lead.id) ?? [];
      return Boolean(event.leadId && relatedLeadIds.includes(event.leadId));
    },
    errorMessage: "Company details could not be loaded"
  });

  const data = resource.data ?? { companies: [], contacts: [], leads: [] };
  const industries = useMemo(() => [...new Set(data.companies.map((company) => company.industry).filter((value): value is string => Boolean(value)))].sort(), [data.companies]);
  const visibleCompanies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return data.companies
      .filter((company) => !industry || company.industry === industry)
      .filter((company) => {
        const leads = data.leads.filter((lead) => lead.companyId === company.id);
        return !status || companyStatus(leads) === status;
      })
      .filter((company) => !query || [company.name, company.website, company.industry, company.location].some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((left, right) => {
        if (sort === "contacts") {
          return data.contacts.filter((contact) => contact.companyId === right.id).length - data.contacts.filter((contact) => contact.companyId === left.id).length;
        }
        if (sort === "activity") {
          const latest = (companyId: string): number => Math.max(0, ...data.leads.filter((lead) => lead.companyId === companyId).map((lead) => new Date(lead.lastActivityAt ?? 0).getTime()));
          return latest(right.id) - latest(left.id);
        }
        return left.name.localeCompare(right.name);
      });
  }, [data.companies, data.contacts, data.leads, industry, search, sort, status]);

  return (
    <section className="records-workspace companies-workspace" aria-label="Companies workspace">
      <div className="records-main">
        <header className="records-heading companies-heading">
          <div><span className="records-eyebrow">CRM / Accounts</span><h2>Companies</h2><p>{visibleCompanies.length} authorized accounts</p></div>
          <div className="view-toggle" aria-label="Company view">
            <button aria-label="Grid view" aria-pressed={mode === "grid"} className={mode === "grid" ? "active" : ""} onClick={() => setMode("grid")} type="button"><Grid2X2 size={17} /></button>
            <button aria-label="List view" aria-pressed={mode === "list"} className={mode === "list" ? "active" : ""} onClick={() => setMode("list")} type="button"><List size={17} /></button>
          </div>
        </header>
        <div className="records-toolbar company-toolbar">
          <label className="records-search"><Search size={17} /><input aria-label="Search companies" onChange={(event) => setSearch(event.target.value)} placeholder="Search company, website or location" type="search" value={search} /></label>
          <label><Building2 size={16} /><select aria-label="Filter companies by industry" onChange={(event) => setIndustry(event.target.value)} value={industry}><option value="">All industries</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><UsersRound size={16} /><select aria-label="Filter companies by status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DORMANT">Dormant</option></select></label>
          <label><SlidersHorizontal size={16} /><select aria-label="Sort companies" onChange={(event) => setSort(event.target.value as CompanySort)} value={sort}><option value="name">Company name</option><option value="activity">Latest activity</option><option value="contacts">Most contacts</option></select></label>
        </div>

        {resource.loading && !resource.data ? <StateBlock title="Loading companies" detail="Fetching authorized accounts and relationships." /> : null}
        {resource.error && !resource.data ? <StateBlock title="Companies unavailable" detail={resource.error} action={<Button onClick={() => void resource.reload()}>Retry</Button>} /> : null}
        {!resource.loading && !resource.error && visibleCompanies.length === 0 ? <StateBlock title="No matching companies" detail="Try changing the search or account filters." /> : null}

        {visibleCompanies.length > 0 ? <div className={`company-collection ${mode}`}>
          {visibleCompanies.map((company) => {
            const contacts = data.contacts.filter((contact) => contact.companyId === company.id);
            const leads = data.leads.filter((lead) => lead.companyId === company.id);
            const owners = companyOwners(leads);
            const href = websiteHref(company);
            const accountStatus = companyStatus(leads);
            return <article className="company-card" key={company.id}>
              <header><span className="company-mark" aria-hidden="true">{company.name.slice(0, 2).toUpperCase()}</span><div><h3>{company.name}</h3><p>{company.industry ?? "Industry not set"}</p></div><Badge tone={accountStatus === "ACTIVE" ? "success" : "neutral"}>{accountStatus}</Badge></header>
              <dl className="company-facts"><div><dt>Location</dt><dd>{company.location ?? "Not set"}</dd></div><div><dt>Company size</dt><dd>{company.employeeRange ?? "Not set"}</dd></div><div><dt>Contacts</dt><dd>{contacts.length}</dd></div><div><dt>Open pipeline</dt><dd>{pipelineValue(leads)}</dd></div></dl>
              <div className="company-owners"><span>Owners</span><div className="avatar-stack">{owners.length ? owners.slice(0, 4).map((owner) => <span key={owner.id} title={`${owner.firstName} ${owner.lastName}`}>{owner.firstName.slice(0, 1)}{owner.lastName.slice(0, 1)}</span>) : <small>Unassigned</small>}</div></div>
              <footer>
                <div className="contact-quick-actions">
                  {href ? <a aria-label={`Open ${company.name} website`} href={href} rel="noreferrer" target="_blank"><ExternalLink size={16} /></a> : null}
                  {contacts[0]?.email ? <a aria-label={`Email ${company.name}`} href={`mailto:${contacts[0].email}`}><Mail size={16} /></a> : null}
                </div>
                <Button onClick={() => setSelectedCompanyId(company.id)} size="sm" variant="ghost">View account <ArrowUpRight size={15} /></Button>
              </footer>
            </article>;
          })}
        </div> : null}
      </div>

      <Drawer
        open={selectedCompanyId !== null}
        onClose={() => setSelectedCompanyId(null)}
        title="Company details"
        footer={detail.data?.leads[0] ? <Button onClick={() => {
          const lead = detail.data?.leads[0];
          if (lead) onOpenLead(lead.id, "Overview");
        }}>Open primary lead <ArrowUpRight size={15} /></Button> : undefined}
      >
        {detail.loading && !detail.data ? <StateBlock title="Loading company" detail="Fetching linked contacts, leads and activity." /> : null}
        {detail.error && !detail.data ? <StateBlock title="Company unavailable" detail={detail.error} action={<Button onClick={() => void detail.reload()}>Retry</Button>} /> : null}
        {detail.data ? <div className="company-drawer">
          <header><span className="company-mark" aria-hidden="true">{detail.data.company.name.slice(0, 2).toUpperCase()}</span><div><h3>{detail.data.company.name}</h3><p>{detail.data.company.industry ?? "Industry not set"}</p></div></header>
          <div className="company-drawer-facts"><span><MapPin size={15} />{detail.data.company.location ?? "Location not set"}</span><span><UsersRound size={15} />{detail.data.company.employeeRange ?? "Size not set"}</span>{websiteHref(detail.data.company) ? <a href={websiteHref(detail.data.company) ?? undefined} rel="noreferrer" target="_blank"><ExternalLink size={15} />{detail.data.company.website}</a> : null}</div>
          <section><header><h4>Contacts</h4><Badge>{detail.data.contacts.length}</Badge></header>{detail.data.contacts.length ? <div className="company-related-list">{detail.data.contacts.map((contact) => <article key={contact.id}><div><strong>{contact.firstName} {contact.lastName}</strong><span>{contact.title ?? "Title not set"}</span></div>{contact.email ? <a aria-label={`Email ${contact.firstName} ${contact.lastName}`} href={`mailto:${contact.email}`}><Mail size={15} /></a> : null}</article>)}</div> : <p className="records-muted">No linked contacts.</p>}</section>
          <section><header><h4>Leads and deals</h4><Badge>{detail.data.leads.length}</Badge></header>{detail.data.leads.length ? <div className="company-related-list">{detail.data.leads.map((lead) => <article key={lead.id}><div><strong>{leadName(lead)}</strong><span>{lead.stage.label} / {lead.status}</span></div><div><Button onClick={() => onOpenLead(lead.id, "Overview")} size="sm" variant="ghost">Lead</Button><Button onClick={() => onOpenLead(lead.id, "Deal")} size="sm" variant="ghost">Deal</Button></div></article>)}</div> : <p className="records-muted">No linked leads or deal context.</p>}</section>
          <section><header><h4>Recent activity</h4><Badge>{detail.data.activities.length}</Badge></header><LeadTimeline activities={detail.data.activities.slice(0, 8)} /></section>
        </div> : null}
      </Drawer>
    </section>
  );
}
