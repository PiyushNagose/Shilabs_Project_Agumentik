import type React from "react";
import { useMemo, useState } from "react";
import type { PublicUser, WorkspaceRoleName } from "@shilabs/shared-types";
import { Plus, Search, UserRound, UserRoundX } from "lucide-react";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  apiErrorMessage,
  createUser,
  listUsers,
  updateUser,
  updateUserStatus
} from "../../services/api-client.js";

const roleOptions = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Administrator" },
  { value: "SALES_MANAGER", label: "Sales manager" },
  { value: "SALES_REP", label: "Sales representative" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "VIEWER", label: "Viewer" }
];
const statusOptions = [
  { value: "ALL", label: "All accounts" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" }
];
const roleLabel: Record<WorkspaceRoleName, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  SALES_MANAGER: "Sales manager",
  SALES_REP: "Sales representative",
  OPERATIONS: "Operations",
  VIEWER: "Viewer"
};

function memberRole(person: PublicUser): WorkspaceRoleName {
  return person.workspaceRole ?? person.role;
}

function canManageMembers(person: PublicUser): boolean {
  return ["OWNER", "ADMIN"].includes(memberRole(person));
}

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  role: WorkspaceRoleName;
  password: string;
}
const emptyForm: UserForm = {
  firstName: "",
  lastName: "",
  email: "",
  role: "SALES_REP",
  password: ""
};

export function UsersWorkspace({
  accessToken,
  currentUser
}: {
  accessToken: string;
  currentUser: PublicUser;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resource = usePersistedResource({
    scope: "workspace-users",
    load: () => listUsers(accessToken),
    accepts: (event) => event.entityType === "workspace",
    errorMessage: "Team members could not be loaded."
  });
  const users = useMemo(
    () =>
      (resource.data ?? []).filter((person) => {
        const matchesStatus = status === "ALL" || person.status === status;
        const haystack = `${person.firstName} ${person.lastName} ${person.email} ${roleLabel[memberRole(person)]}`;
        return matchesStatus && haystack.toLowerCase().includes(query.toLowerCase());
      }),
    [query, resource.data, status]
  );
  const currentUserIsOwner = memberRole(currentUser) === "OWNER";
  const availableRoleOptions = currentUserIsOwner
    ? roleOptions
    : roleOptions.filter((option) => option.value !== "OWNER");

  const saveNew = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createUser(accessToken, form);
      setForm(emptyForm);
      setCreateOpen(false);
      await resource.reload();
    } catch (cause) {
      setError(apiErrorMessage(cause, "The team member could not be added."));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await updateUser(accessToken, editing.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role
      });
      setEditing(null);
      await resource.reload();
    } catch (cause) {
      setError(apiErrorMessage(cause, "Changes could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (person: PublicUser): Promise<void> => {
    if (person.id === currentUser.id) return;
    const next = person.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    if (
      !window.confirm(
        `${next === "INACTIVE" ? "Deactivate" : "Reactivate"} ${person.firstName} ${person.lastName}?`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await updateUserStatus(accessToken, person.id, next);
      await resource.reload();
    } catch (cause) {
      setError(apiErrorMessage(cause, "Account status could not be changed."));
    } finally {
      setBusy(false);
    }
  };

  if (resource.loading && !resource.data)
    return <StateBlock title="Loading team" detail="Getting members in this workspace." />;
  if (resource.error && !resource.data)
    return (
      <StateBlock
        title="Team unavailable"
        detail={resource.error}
        action={<Button onClick={() => void resource.reload()}>Retry</Button>}
      />
    );

  const openCreate = (): void => {
    setError(null);
    setForm(emptyForm);
    setCreateOpen(true);
  };
  const openEdit = (person: PublicUser): void => {
    setError(null);
    setForm({
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      role: memberRole(person),
      password: ""
    });
    setEditing(person);
  };

  return (
    <main className="admin-workspace">
      <header className="admin-page-header">
        <div>
          <span className="section-eyebrow">WORKSPACE / ACCESS</span>
          <h1>Users</h1>
          <p>Manage who can work in this workspace and what they can access.</p>
        </div>
        {canManageMembers(currentUser) ? (
          <Button variant="primary" onClick={openCreate}>
            <Plus size={16} /> Add user
          </Button>
        ) : null}
      </header>
      <section className="admin-summary" aria-label="Team summary">
        <Card>
          <span>Team members</span>
          <strong>{resource.data?.length ?? 0}</strong>
        </Card>
        <Card>
          <span>Active</span>
          <strong>
            {resource.data?.filter((person) => person.status === "ACTIVE").length ?? 0}
          </strong>
        </Card>
        <Card>
          <span>Your role</span>
          <strong>{roleLabel[memberRole(currentUser)]}</strong>
        </Card>
      </section>
      <Card className="admin-list-card">
        <div className="admin-list-toolbar">
          <label className="admin-search">
            <Search size={17} />
            <input
              aria-label="Search team members"
              placeholder="Search name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select
            ariaLabel="Filter team members by status"
            options={statusOptions}
            value={status}
            onChange={setStatus}
          />
          <Button aria-label="Refresh team" onClick={() => void resource.reload()}>
            Refresh
          </Button>
        </div>
        {error ? (
          <p className="admin-inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Added</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr key={person.id}>
                  <td data-label="Team member">
                    <div className="admin-person">
                      <span className="admin-avatar">
                        {person.firstName.slice(0, 1)}
                        {person.lastName.slice(0, 1)}
                      </span>
                      <span>
                        <strong>
                          {person.firstName} {person.lastName}
                          {person.id === currentUser.id ? <small> (you)</small> : null}
                        </strong>
                        <small>{person.email}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="Role">{roleLabel[memberRole(person)]}</td>
                  <td data-label="Status">
                    <Badge tone={person.status === "ACTIVE" ? "success" : "neutral"}>
                      {person.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td data-label="Added">
                    {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                      new Date(person.createdAt)
                    )}
                  </td>
                  <td className="admin-row-actions" data-label="Actions">
                    {canManageMembers(currentUser) &&
                    (currentUserIsOwner || memberRole(person) !== "OWNER") ? (
                      <>
                        <Button size="sm" onClick={() => openEdit(person)}>
                          Edit
                        </Button>
                        {person.id !== currentUser.id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`${person.status === "ACTIVE" ? "Deactivate" : "Reactivate"} ${person.firstName} ${person.lastName}`}
                            onClick={() => void toggleStatus(person)}
                          >
                            {person.status === "ACTIVE" ? (
                              <UserRoundX size={16} />
                            ) : (
                              <UserRound size={16} />
                            )}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <span className="admin-readonly">
                        {memberRole(person) === "OWNER" ? "Owner managed" : "View only"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!users.length ? (
          <div className="admin-empty">
            <strong>No team members found</strong>
            <span>Try another search or account status.</span>
          </div>
        ) : null}
      </Card>
      <Modal
        open={createOpen || Boolean(editing)}
        title={editing ? "Edit team member" : "Add team member"}
        onClose={() => {
          if (!busy) {
            setCreateOpen(false);
            setEditing(null);
            setError(null);
          }
        }}
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setCreateOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="user-form" disabled={busy}>
              {busy ? "Saving..." : editing ? "Save changes" : "Add user"}
            </Button>
          </>
        }
      >
        <form
          id="user-form"
          className={`admin-form-grid ${editing ? "user-edit-form" : "user-create-form"}`}
          onSubmit={(event) => void (editing ? saveEdit(event) : saveNew(event))}
        >
          <label className="admin-field-full">
            Role
            <Select
              ariaLabel="User role"
              disabled={editing?.id === currentUser.id}
              options={availableRoleOptions}
              value={form.role}
              onChange={(value) => setForm({ ...form, role: value as WorkspaceRoleName })}
            />
          </label>
          <label>
            First name
            <input
              autoComplete="given-name"
              required
              maxLength={80}
              value={form.firstName}
              onChange={(event) => setForm({ ...form, firstName: event.target.value })}
            />
          </label>
          <label>
            Last name
            <input
              autoComplete="family-name"
              required
              maxLength={80}
              value={form.lastName}
              onChange={(event) => setForm({ ...form, lastName: event.target.value })}
            />
          </label>
          {!editing ? (
            <label className="admin-field-full">
              Work email
              <input
                autoComplete="email"
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
          ) : null}
          {!editing ? (
            <label className="admin-field-full">
              Temporary password
              <input
                aria-label="Temporary password"
                autoComplete="new-password"
                type="password"
                minLength={10}
                required
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <small>Share this securely with the new team member.</small>
            </label>
          ) : null}
          {error ? (
            <p className="admin-inline-error admin-field-full" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Modal>
    </main>
  );
}
