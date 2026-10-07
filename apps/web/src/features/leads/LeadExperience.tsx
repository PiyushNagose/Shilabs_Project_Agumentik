import type {
  ActivityDto,
  LeadDto,
  LeadQualificationDto,
  MeetingRequestDto,
  TaskDto
} from "@shilabs/shared-types";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Mail,
  Phone,
  Sparkles,
  UserRound
} from "lucide-react";
import { Badge, Button, Drawer } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";

export function leadName(lead: LeadDto): string {
  return `${lead.contact.firstName} ${lead.contact.lastName}`.trim() || lead.company.name;
}

export function leadAiIntent(
  lead: LeadDto,
  qualification: LeadQualificationDto | null
): string {
  const candidates = [
    qualification?.need?.trim(),
    qualification?.requirement?.trim(),
    lead.serviceInterest?.trim(),
    lead.requirement?.trim()
  ];
  return candidates.find((candidate) => candidate !== undefined && candidate.length > 0) ?? "Not identified";
}

export function leadPriority(tasks: TaskDto[]): TaskDto["priority"] | "NONE" {
  const open = tasks.filter((task) => task.status === "OPEN" || task.status === "IN_PROGRESS");
  const rank: Record<TaskDto["priority"], number> = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 };
  return open.sort((left, right) => rank[right.priority] - rank[left.priority])[0]?.priority ?? "NONE";
}

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function actorLabel(activity: ActivityDto): string {
  if (activity.actorUser) {
    return `${activity.actorUser.firstName} ${activity.actorUser.lastName}`;
  }
  if (activity.actorType === "AGENT") return "AI agent";
  if (activity.actorType === "WORKFLOW") return "Workflow";
  if (activity.actorType === "SYSTEM") return "System";
  return "CRM user";
}

export function LeadFactStrip({
  lead,
  qualification,
  tasks
}: {
  lead: LeadDto;
  qualification: LeadQualificationDto | null;
  tasks: TaskDto[];
}): React.JSX.Element {
  const facts = [
    ["Lead status", lead.status.replaceAll("_", " ")],
    ["Deal stage", lead.stage.label],
    ["AI intent", leadAiIntent(lead, qualification)],
    ["Priority", leadPriority(tasks) === "NONE" ? "No open task" : leadPriority(tasks)],
    ["Score", String(lead.score)]
  ];
  return (
    <dl className="lead-fact-strip" aria-label="Lead facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LeadTimeline({ activities }: { activities: ActivityDto[] }): React.JSX.Element {
  if (activities.length === 0) {
    return <StateBlock title="No business activity yet" detail="Customer and sales activity will appear here." />;
  }
  return (
    <ol className="lead-timeline" aria-label="Lead business activity">
      {activities.map((activity) => (
        <li key={activity.id}>
          <span className="timeline-marker" aria-hidden="true"><Sparkles size={15} /></span>
          <article>
            <header>
              <div>
                <strong>{activity.title}</strong>
                <span>{actorLabel(activity)} / {activity.sourceType ?? "CRM"}</span>
              </div>
              <time dateTime={activity.occurredAt}>{formatDate(activity.occurredAt)}</time>
            </header>
            <p>{activity.summary || activity.description || "Activity recorded"}</p>
            {activity.summary && activity.description !== activity.summary ? (
              <small>{activity.description}</small>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}

export function LeadTaskList({
  tasks,
  loading,
  error,
  onComplete
}: {
  tasks: TaskDto[];
  loading: boolean;
  error: string | null;
  onComplete: (taskId: string) => Promise<void>;
}): React.JSX.Element {
  if (loading) return <StateBlock title="Loading tasks" detail="Fetching assigned and automated work." />;
  if (error) return <StateBlock title="Tasks unavailable" detail={error} />;
  if (tasks.length === 0) return <StateBlock title="No tasks" detail="This lead has no assigned work yet." />;
  return (
    <div className="lead-task-list">
      {tasks.map((task) => {
        const completed = task.status === "COMPLETED";
        return (
          <article className={completed ? "completed" : ""} key={task.id}>
            <button
              aria-label={completed ? `${task.title} completed` : `Complete ${task.title}`}
              className="task-check"
              disabled={completed}
              onClick={() => void onComplete(task.id)}
              type="button"
            >
              {completed ? <Check size={15} /> : null}
            </button>
            <div>
              <strong>{task.title}</strong>
              {task.description ? <p>{task.description}</p> : null}
              <span>
                {task.assignedToUser
                  ? `${task.assignedToUser.firstName} ${task.assignedToUser.lastName}`
                  : task.createdByType.replaceAll("_", " ")}
              </span>
            </div>
            <div className="task-meta">
              <Badge tone={task.priority === "URGENT" || task.priority === "HIGH" ? "danger" : "neutral"}>
                {task.priority}
              </Badge>
              <time dateTime={task.dueAt ?? undefined}>{formatDate(task.dueAt)}</time>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function LeadQuickView({
  activities,
  lead,
  qualification,
  tasks,
  tasksLoading,
  tasksError,
  meetings,
  open,
  onClose,
  onCompleteTask,
  onOpenProfile
}: {
  activities: ActivityDto[];
  lead: LeadDto | null;
  qualification: LeadQualificationDto | null;
  tasks: TaskDto[];
  tasksLoading: boolean;
  tasksError: string | null;
  meetings: MeetingRequestDto[];
  open: boolean;
  onClose: () => void;
  onCompleteTask: (taskId: string) => Promise<void>;
  onOpenProfile: () => void;
}): React.JSX.Element | null {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Lead quick view"
      footer={
        <Button onClick={onOpenProfile} variant="primary">
          View full profile <ChevronRight size={16} />
        </Button>
      }
    >
      {!lead ? (
        <StateBlock title="Loading lead" detail="Fetching the latest persisted record." />
      ) : (
        <div className="lead-quick-view">
          <header className="quick-lead-header">
            <span className="lead-avatar" aria-hidden="true">{lead.contact.firstName.slice(0, 1)}{lead.contact.lastName.slice(0, 1)}</span>
            <div>
              <h3>{leadName(lead)}</h3>
              <p><Building2 size={14} /> {lead.company.name}</p>
            </div>
            <div className="quick-contact-actions">
              {lead.contact.email ? <a aria-label={`Email ${leadName(lead)}`} href={`mailto:${lead.contact.email}`}><Mail size={16} /></a> : null}
              {lead.contact.phone ? <a aria-label={`Call ${leadName(lead)}`} href={`tel:${lead.contact.phone}`}><Phone size={16} /></a> : null}
            </div>
          </header>

          <LeadFactStrip lead={lead} qualification={qualification} tasks={tasks} />

          <section className="quick-summary-grid" aria-label="Lead summary">
            <article><Mail size={16} /><span>Last activity</span><strong>{formatDate(lead.lastActivityAt)}</strong></article>
            <article><Clock3 size={16} /><span>Next action</span><strong>{lead.nextAction ?? "No next action"}</strong></article>
            <article><CalendarDays size={16} /><span>Meetings</span><strong>{meetings.length}</strong></article>
            <article><UserRound size={16} /><span>Owner</span><strong>{lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}</strong></article>
          </section>

          <section className="quick-section">
            <header><h4>Upcoming tasks</h4><Badge>{tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELED").length}</Badge></header>
            <LeadTaskList tasks={tasks.slice(0, 3)} loading={tasksLoading} error={tasksError} onComplete={onCompleteTask} />
          </section>

          <section className="quick-section">
            <header><h4>Recent activity</h4><Badge>{activities.length}</Badge></header>
            <LeadTimeline activities={activities.slice(0, 4)} />
          </section>
        </div>
      )}
    </Drawer>
  );
}
