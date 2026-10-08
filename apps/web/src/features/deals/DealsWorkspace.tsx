import type {
  ActivityDto,
  DealDto,
  LeadDto,
  MeetingRequestDto,
  PipelineDto,
  ProposalDto,
  PublicUser,
  TaskDto
} from "@shilabs/shared-types";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  DollarSign,
  GripVertical,
  LayoutList,
  Mail,
  Pencil,
  Plus,
  Search,
  Settings2,
  UserRound
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Drawer, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  createDeal,
  createPipeline,
  createPipelineStage,
  getDeal,
  listDeals,
  listLeadActivities,
  listLeads,
  listMeetingRequests,
  listPipelines,
  listProposals,
  listTasks,
  listUsers,
  reorderPipelineStages,
  updateDeal,
  updatePipeline,
  updatePipelineStage
} from "../../services/api-client.js";
import { LeadTimeline, leadName } from "../leads/LeadExperience.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";

type ViewMode = "list" | "board";
interface DealsData {
  deals: DealDto[];
  total: number;
  pipelines: PipelineDto[];
  users: PublicUser[];
  leads: LeadDto[];
}
interface RelatedData {
  activities: ActivityDto[];
  tasks: TaskDto[];
  meetings: MeetingRequestDto[];
  proposals: ProposalDto[];
}

function money(deal: DealDto): string {
  if (!deal.value) return "Value not set";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: deal.currency,
    maximumFractionDigits: 0
  }).format(Number(deal.value));
}
function date(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
function initials(deal: DealDto): string {
  return `${deal.lead.contact.firstName[0] ?? ""}${deal.lead.contact.lastName[0] ?? ""}`.toUpperCase();
}

function DealRelations({
  data,
  loading,
  error
}: {
  data: RelatedData | null;
  loading: boolean;
  error: string | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<"activity" | "tasks" | "meetings" | "proposals">("activity");
  if (loading)
    return <StateBlock title="Loading related work" detail="Fetching persisted CRM records." />;
  if (error || !data)
    return (
      <StateBlock
        title="Related work unavailable"
        detail={error ?? "No related data was returned."}
      />
    );
  const tabs = [
    ["activity", "Activity", data.activities.length],
    ["tasks", "Tasks", data.tasks.length],
    ["meetings", "Meetings", data.meetings.length],
    ["proposals", "Proposals", data.proposals.length]
  ] as const;
  return (
    <section className="deal-relations">
      <nav className="deal-tabs" aria-label="Deal related records">
        {tabs.map(([id, label, count]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </nav>
      <div className="deal-related-body">
        {tab === "activity" ? <LeadTimeline activities={data.activities} /> : null}
        {tab === "tasks" ? (
          data.tasks.length ? (
            data.tasks.map((task) => (
              <article className="deal-related-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.description ?? "No description"}</span>
                </div>
                <Badge>{task.status}</Badge>
                <time>{date(task.dueAt)}</time>
              </article>
            ))
          ) : (
            <StateBlock title="No tasks" detail="Tasks linked to this lead will appear here." />
          )
        ) : null}
        {tab === "meetings" ? (
          data.meetings.length ? (
            data.meetings.map((meeting) => (
              <article className="deal-related-row" key={meeting.id}>
                <div>
                  <strong>{meeting.title}</strong>
                  <span>{meeting.timeZone}</span>
                </div>
                <Badge>{meeting.status}</Badge>
                <time>{date(meeting.windowStart)}</time>
              </article>
            ))
          ) : (
            <StateBlock title="No meetings" detail="Scheduled meetings will appear here." />
          )
        ) : null}
        {tab === "proposals" ? (
          data.proposals.length ? (
            data.proposals.map((proposal) => (
              <article className="deal-related-row" key={proposal.id}>
                <div>
                  <strong>{proposal.title}</strong>
                  <span>{proposal.serviceType ?? "General proposal"}</span>
                </div>
                <Badge>{proposal.status}</Badge>
                <time>{date(proposal.updatedAt)}</time>
              </article>
            ))
          ) : (
            <StateBlock
              title="No proposals"
              detail="Proposals linked to this deal or lead will appear here."
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function DealSummary({
  deal,
  onOpenLead
}: {
  deal: DealDto;
  onOpenLead: (leadId: string, tab?: DetailTab) => void;
}): React.JSX.Element {
  const facts = [
    ["Value", money(deal)],
    ["Probability", `${String(deal.probability)}%`],
    ["Close date", date(deal.closeDate)],
    ["Owner", deal.owner ? `${deal.owner.firstName} ${deal.owner.lastName}` : "Unassigned"],
    ["Company", deal.lead.company.name],
    ["Contact", leadName(deal.lead)]
  ];
  return (
    <>
      <header className="deal-identity">
        <span className="deal-avatar">{initials(deal)}</span>
        <div>
          <h2>{deal.lead.company.name}</h2>
          <p>
            {leadName(deal.lead)} / {deal.stage.label}
          </p>
        </div>
        <Badge
          tone={deal.status === "LOST" ? "danger" : deal.status === "WON" ? "success" : "neutral"}
        >
          {deal.status}
        </Badge>
      </header>
      <dl className="deal-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="deal-contact-actions">
        {deal.lead.contact.email ? (
          <a href={`mailto:${deal.lead.contact.email}`}>
            <Mail size={15} /> Email
          </a>
        ) : null}
        <Button onClick={() => onOpenLead(deal.leadId, "Overview")} size="sm" variant="secondary">
          <UserRound size={15} /> Open lead
        </Button>
      </div>
    </>
  );
}

function PipelineManager({
  accessToken,
  pipelines,
  activeId,
  onDone
}: {
  accessToken: string;
  pipelines: PipelineDto[];
  activeId: string;
  onDone: () => Promise<void>;
}): React.JSX.Element {
  const [pipelineId, setPipelineId] = useState(activeId);
  const [pipelineName, setPipelineName] = useState("");
  const [stageName, setStageName] = useState("");
  const [probability, setProbability] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pipeline = pipelines.find((item) => item.id === pipelineId) ?? pipelines[0];
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch {
      setError("The pipeline change could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const move = (index: number, direction: -1 | 1): void => {
    if (!pipeline) return;
    const ids = pipeline.stages.map((stage) => stage.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const current = ids[index];
    const replacement = ids[target];
    if (!current || !replacement) return;
    ids[index] = replacement;
    ids[target] = current;
    void run(() => reorderPipelineStages(accessToken, pipeline.id, ids));
  };
  return (
    <div className="pipeline-manager">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <label>
        Pipeline
        <Select
          ariaLabel="Pipeline"
          onChange={setPipelineId}
          options={pipelines.map((item) => ({ value: item.id, label: item.name }))}
          value={pipeline?.id ?? ""}
        />
      </label>
      <div className="pipeline-create">
        <input
          aria-label="New pipeline name"
          onChange={(event) => setPipelineName(event.target.value)}
          placeholder="New pipeline name"
          value={pipelineName}
        />
        <Button
          disabled={busy || !pipelineName.trim()}
          onClick={() =>
            void run(async () => {
              await createPipeline(accessToken, { name: pipelineName });
              setPipelineName("");
            })
          }
        >
          <Plus size={15} /> Add pipeline
        </Button>
      </div>
      {pipeline ? (
        <>
          <div className="pipeline-name-row">
            <input
              aria-label="Pipeline name"
              defaultValue={pipeline.name}
              key={pipeline.id}
              onBlur={(event) => {
                if (event.target.value.trim() && event.target.value.trim() !== pipeline.name)
                  void run(() =>
                    updatePipeline(accessToken, pipeline.id, { name: event.target.value.trim() })
                  );
              }}
            />
            <Badge>{pipeline.status}</Badge>
            <Button
              disabled={busy || (pipeline.isDefault && pipeline.status === "ACTIVE")}
              onClick={() =>
                void run(() =>
                  updatePipeline(accessToken, pipeline.id, {
                    status: pipeline.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"
                  })
                )
              }
              size="sm"
              variant="ghost"
            >
              {pipeline.status === "ACTIVE" ? "Archive" : "Reactivate"}
            </Button>
          </div>
          <div className="pipeline-stage-list">
            {pipeline.stages.map((stage, index) => (
              <article key={stage.id}>
                <GripVertical size={15} />
                <input
                  aria-label={`${stage.label} name`}
                  defaultValue={stage.label}
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value.trim() !== stage.label)
                      void run(() =>
                        updatePipelineStage(accessToken, stage.id, {
                          name: event.target.value.trim()
                        })
                      );
                  }}
                />
                <span>{stage.probability}%</span>
                <Button
                  aria-label={`Move ${stage.label} left`}
                  disabled={busy || index === 0}
                  iconOnly
                  onClick={() => move(index, -1)}
                  size="sm"
                >
                  <ChevronLeft size={15} />
                </Button>
                <Button
                  aria-label={`Move ${stage.label} right`}
                  disabled={busy || index === pipeline.stages.length - 1}
                  iconOnly
                  onClick={() => move(index, 1)}
                  size="sm"
                >
                  <ChevronRight size={15} />
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      updatePipelineStage(accessToken, stage.id, {
                        status: stage.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"
                      })
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  {stage.status === "ACTIVE" ? "Archive" : "Reactivate"}
                </Button>
              </article>
            ))}
          </div>
          <div className="pipeline-create">
            <input
              aria-label="New stage name"
              onChange={(event) => setStageName(event.target.value)}
              placeholder="New stage"
              value={stageName}
            />
            <input
              aria-label="Stage probability"
              max={100}
              min={0}
              onChange={(event) => setProbability(Number(event.target.value))}
              type="number"
              value={probability}
            />
            <Button
              disabled={busy || !stageName.trim()}
              onClick={() =>
                void run(async () => {
                  await createPipelineStage(accessToken, pipeline.id, {
                    name: stageName,
                    probability
                  });
                  setStageName("");
                })
              }
            >
              <Plus size={15} /> Add stage
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function DealEditor({
  accessToken,
  deal,
  pipelines,
  users,
  onSaved
}: {
  accessToken: string;
  deal: DealDto;
  pipelines: PipelineDto[];
  users: PublicUser[];
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [stageId, setStageId] = useState(deal.stageId);
  const [ownerId, setOwnerId] = useState(deal.ownerId ?? "");
  const [value, setValue] = useState(deal.value ?? "");
  const [probability, setProbability] = useState(deal.probability);
  const [closeDate, setCloseDate] = useState(deal.closeDate?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stages = pipelines
    .filter((pipeline) => pipeline.status === "ACTIVE")
    .flatMap((pipeline) => pipeline.stages.filter((stage) => stage.status !== "ARCHIVED"));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await updateDeal(accessToken, deal.id, {
        stageId,
        ownerId: ownerId || null,
        value: value || null,
        probability,
        closeDate: closeDate ? new Date(`${closeDate}T12:00:00`).toISOString() : null
      });
      await onSaved();
    } catch {
      setError("The deal changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="deal-editor">
      <header>
        <div>
          <span className="records-eyebrow">DEAL INFO</span>
          <h3>Commercial details</h3>
        </div>
        <Button disabled={busy} onClick={() => void save()} variant="primary">
          <Pencil size={15} /> {busy ? "Saving" : "Save changes"}
        </Button>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="deal-editor-grid">
        <label>
          Stage
          <Select
            ariaLabel="Deal stage"
            onChange={setStageId}
            options={stages.map((stage) => ({ value: stage.id, label: stage.label }))}
            value={stageId}
          />
        </label>
        <label>
          Owner
          <Select
            ariaLabel="Deal owner"
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
          Value
          <input
            min="0"
            onChange={(event) => setValue(event.target.value)}
            placeholder="0.00"
            step="0.01"
            type="number"
            value={value}
          />
        </label>
        <label>
          Probability
          <input
            max="100"
            min="0"
            onChange={(event) => setProbability(Number(event.target.value))}
            type="number"
            value={probability}
          />
        </label>
        <label>
          Expected close
          <input
            onChange={(event) => setCloseDate(event.target.value)}
            type="date"
            value={closeDate}
          />
        </label>
      </div>
    </section>
  );
}

export function DealsWorkspace({
  accessToken,
  currentUser,
  initialDealId,
  onRouteChange,
  onOpenLead
}: {
  accessToken: string;
  currentUser: PublicUser;
  initialDealId: string | null;
  onRouteChange: (dealId: string | null) => void;
  onOpenLead: (leadId: string | null, tab?: DetailTab) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLeadId, setCreateLeadId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const resource = usePersistedResource<DealsData>({
    scope: `deals:${search}:${status}:${pipelineId}`,
    load: async () => {
      const [dealPage, pipelines, users, leadPage] = await Promise.all([
        listDeals(accessToken, {
          search,
          status: status as "OPEN" | "WON" | "LOST" | undefined,
          pipelineId: pipelineId || undefined,
          pageSize: 100
        }),
        listPipelines(accessToken),
        listUsers(accessToken),
        listLeads(accessToken, { pageSize: 100 })
      ]);
      return {
        deals: dealPage.items,
        total: dealPage.total,
        pipelines,
        users,
        leads: leadPage.items
      };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["deal", "pipeline", "lead", "task", "activity"].includes(event.entityType),
    errorMessage: "Deals could not be loaded."
  });
  const detailId = initialDealId ?? selectedId;
  const detail = usePersistedResource<DealDto | null>({
    scope: `deal:${detailId ?? "none"}`,
    load: () => (detailId ? getDeal(accessToken, detailId) : Promise.resolve(null)),
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      event.entityType === "deal" ||
      event.entityType === "lead",
    errorMessage: "Deal details could not be loaded."
  });
  const related = usePersistedResource<RelatedData | null>({
    scope: `deal-related:${detail.data?.id ?? "none"}`,
    load: () =>
      detail.data
        ? Promise.all([
            listLeadActivities(accessToken, detail.data.leadId),
            listTasks(accessToken, { leadId: detail.data.leadId }),
            listMeetingRequests(accessToken, { leadId: detail.data.leadId }),
            listProposals(accessToken, { leadId: detail.data.leadId, limit: 50 })
          ]).then(([activities, tasks, meetings, proposals]) => ({
            activities,
            tasks,
            meetings,
            proposals
          }))
        : Promise.resolve(null),
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["deal", "task", "activity", "lead"].includes(event.entityType),
    errorMessage: "Related deal records could not be loaded."
  });
  const data = resource.data;
  const activePipeline = useMemo(
    () =>
      data?.pipelines.find((item) => item.id === pipelineId) ??
      data?.pipelines.find((item) => item.isDefault) ??
      data?.pipelines[0],
    [data, pipelineId]
  );
  const canManage = currentUser.role === "ADMIN" || currentUser.role === "SALES_MANAGER";
  const quickDeal = detail.data;
  const moveDeal = async (dealId: string, stageId: string): Promise<void> => {
    setMutationError(null);
    try {
      await updateDeal(accessToken, dealId, { stageId });
      await Promise.all([resource.reload(), detail.reload()]);
    } catch {
      setMutationError("The deal could not be moved. Refresh and try again.");
    }
  };

  if (initialDealId)
    return (
      <div className="deals-workspace deal-detail-workspace">
        <button className="deal-back" onClick={() => onRouteChange(null)} type="button">
          <ArrowLeft size={16} /> Back to deals
        </button>
        {detail.loading ? (
          <StateBlock title="Loading deal" detail="Fetching the latest workspace data." />
        ) : detail.error || !detail.data ? (
          <StateBlock
            title="Deal unavailable"
            detail={detail.error ?? "This deal is no longer available."}
          />
        ) : (
          <div className="deal-detail-card">
            <DealSummary deal={detail.data} onOpenLead={(id, tab) => onOpenLead(id, tab)} />
            {data ? (
              <DealEditor
                accessToken={accessToken}
                deal={detail.data}
                key={detail.data.updatedAt}
                onSaved={async () => {
                  await Promise.all([detail.reload(), resource.reload()]);
                }}
                pipelines={data.pipelines}
                users={data.users}
              />
            ) : null}
            <DealRelations data={related.data} loading={related.loading} error={related.error} />
          </div>
        )}
      </div>
    );

  return (
    <div className="deals-workspace">
      <section className="deals-toolbar">
        <div>
          <span className="records-eyebrow">CRM / DEALS</span>
          <h2>Deals</h2>
          <p>{data?.total ?? 0} authorized records</p>
        </div>
        <div className="deals-actions">
          <div className="deal-view-toggle">
            <Button
              aria-label="List view"
              className={mode === "list" ? "active" : ""}
              iconOnly
              onClick={() => setMode("list")}
            >
              <LayoutList size={17} />
            </Button>
            <Button
              aria-label="Pipeline view"
              className={mode === "board" ? "active" : ""}
              iconOnly
              onClick={() => setMode("board")}
            >
              <Columns3 size={17} />
            </Button>
          </div>
          {canManage ? (
            <Button onClick={() => setManageOpen(true)}>
              <Settings2 size={16} /> Manage pipeline
            </Button>
          ) : null}
          <Button onClick={() => setCreateOpen(true)} variant="primary">
            <Plus size={16} /> New deal
          </Button>
        </div>
      </section>
      <section className="deal-filters">
        <label>
          <Search size={16} />
          <input
            aria-label="Search deals"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search deals, contacts or companies"
            value={search}
          />
        </label>
        <Select
          ariaLabel="Pipeline"
          className="deal-filter-select"
          icon={<BriefcaseBusiness size={16} />}
          onChange={setPipelineId}
          options={[
            { value: "", label: "All pipelines" },
            ...(data?.pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name })) ??
              [])
          ]}
          value={pipelineId}
        />
        <Select
          ariaLabel="Deal status"
          className="deal-filter-select"
          icon={<Columns3 size={16} />}
          onChange={setStatus}
          options={[
            { value: "", label: "All statuses" },
            { value: "OPEN", label: "Open" },
            { value: "WON", label: "Won" },
            { value: "LOST", label: "Lost" }
          ]}
          value={status}
        />
      </section>
      {mutationError ? (
        <p className="form-error" role="alert">
          {mutationError}
        </p>
      ) : null}
      {resource.loading && !data ? (
        <StateBlock title="Loading deals" detail="Fetching pipelines and deal records." />
      ) : resource.error ? (
        <StateBlock
          action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          title="Deals unavailable"
          detail={resource.error}
        />
      ) : !data || data.deals.length === 0 ? (
        <StateBlock
          action={
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              <Plus size={15} /> New deal
            </Button>
          }
          title="No deals found"
          detail="Create a deal or adjust the current filters."
        />
      ) : mode === "list" ? (
        <section className="deal-table" aria-label="Deals list">
          <div className="deal-table-row head">
            <span>Deal</span>
            <span>Stage</span>
            <span>Owner</span>
            <span>Value</span>
            <span>Probability</span>
            <span>Close date</span>
            <span>Status</span>
          </div>
          {data.deals.map((deal) => (
            <button
              className="deal-table-row"
              key={deal.id}
              onClick={() => setSelectedId(deal.id)}
              type="button"
            >
              <span className="deal-name-cell">
                <i>{initials(deal)}</i>
                <span>
                  <strong>{deal.lead.company.name}</strong>
                  <small>{leadName(deal.lead)}</small>
                </span>
              </span>
              <span>
                <Badge>{deal.stage.label}</Badge>
              </span>
              <span>
                {deal.owner ? `${deal.owner.firstName} ${deal.owner.lastName}` : "Unassigned"}
              </span>
              <span>{money(deal)}</span>
              <span>{deal.probability}%</span>
              <span>{date(deal.closeDate)}</span>
              <span>
                <Badge
                  tone={
                    deal.status === "LOST"
                      ? "danger"
                      : deal.status === "WON"
                        ? "success"
                        : "neutral"
                  }
                >
                  {deal.status}
                </Badge>
              </span>
            </button>
          ))}
        </section>
      ) : (
        <section className="deal-board" aria-label="Pipeline board">
          {activePipeline?.stages
            .filter((stage) => stage.status !== "ARCHIVED")
            .map((stage) => {
              const deals = data.deals.filter((deal) => deal.stageId === stage.id);
              return (
                <section
                  className="deal-column"
                  key={stage.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    void moveDeal(event.dataTransfer.getData("text/deal-id"), stage.id)
                  }
                >
                  <header>
                    <div>
                      <span
                        className="stage-color"
                        style={{ backgroundColor: stage.color ?? "#94a3b8" }}
                      />
                      <strong>{stage.label}</strong>
                      <Badge>{deals.length}</Badge>
                    </div>
                    <small>{stage.probability}% probability</small>
                  </header>
                  <div>
                    {deals.map((deal) => (
                      <article
                        draggable
                        key={deal.id}
                        onClick={() => setSelectedId(deal.id)}
                        onDragStart={(event) => event.dataTransfer.setData("text/deal-id", deal.id)}
                      >
                        <div>
                          <span className="deal-avatar small">{initials(deal)}</span>
                          <strong>{deal.lead.company.name}</strong>
                        </div>
                        <p>{leadName(deal.lead)}</p>
                        <footer>
                          <span>
                            <DollarSign size={13} /> {money(deal)}
                          </span>
                          <span>
                            <CalendarDays size={13} /> {date(deal.closeDate)}
                          </span>
                        </footer>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
        </section>
      )}
      <Drawer
        footer={
          quickDeal ? (
            <Button
              onClick={() => {
                setSelectedId(null);
                onRouteChange(quickDeal.id);
              }}
              variant="primary"
            >
              Open deal workspace <ArrowRight size={16} />
            </Button>
          ) : undefined
        }
        onClose={() => setSelectedId(null)}
        open={Boolean(selectedId)}
        title="Deal quick view"
      >
        {detail.loading || !detail.data ? (
          <StateBlock title="Loading deal" detail="Fetching deal context." />
        ) : (
          <div className="deal-quick-view">
            <DealSummary deal={detail.data} onOpenLead={(id, tab) => onOpenLead(id, tab)} />
            <DealRelations data={related.data} loading={related.loading} error={related.error} />
          </div>
        )}
      </Drawer>
      <Modal onClose={() => setManageOpen(false)} open={manageOpen} title="Pipeline settings">
        {data && activePipeline ? (
          <PipelineManager
            accessToken={accessToken}
            activeId={activePipeline.id}
            onDone={resource.reload}
            pipelines={data.pipelines}
          />
        ) : null}
      </Modal>
      <Modal
        footer={
          <Button
            disabled={!createLeadId || !activePipeline?.stages[0]}
            onClick={() =>
              void (async () => {
                if (!createLeadId || !activePipeline?.stages[0]) return;
                setMutationError(null);
                try {
                  await createDeal(accessToken, {
                    leadId: createLeadId,
                    stageId: activePipeline.stages[0].id
                  });
                  setCreateOpen(false);
                  setCreateLeadId("");
                  await resource.reload();
                } catch {
                  setMutationError(
                    "The deal could not be created. The lead may already have a deal."
                  );
                }
              })()
            }
            variant="primary"
          >
            Create deal
          </Button>
        }
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="New deal"
      >
        <div className="deal-create-form">
          <label>
            Related lead
            <Select
              ariaLabel="Related lead"
              onChange={setCreateLeadId}
              options={[
                { value: "", label: "Select a lead" },
                ...(data?.leads
                  .filter((lead) => !data.deals.some((deal) => deal.leadId === lead.id))
                  .map((lead) => ({
                    value: lead.id,
                    label: `${leadName(lead)} / ${lead.company.name}`
                  })) ?? [])
              ]}
              value={createLeadId}
            />
          </label>
          <p>
            The deal starts in {activePipeline?.stages[0]?.label ?? "the first active stage"}.
            Value, owner, probability and close date can be updated from the deal workspace.
          </p>
        </div>
      </Modal>
    </div>
  );
}
