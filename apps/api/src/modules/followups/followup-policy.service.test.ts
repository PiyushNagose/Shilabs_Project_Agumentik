import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpPolicy } from "@prisma/client";
import {
  createFollowUpPolicySchema,
  updateFollowUpPolicySchema
} from "./followup-policy.schemas.js";
import {
  type FollowUpPolicyContext,
  createFollowUpPolicy,
  resolveFollowUpCommunicationPersonality,
  selectFollowUpPolicy,
  updateFollowUpPolicy
} from "./followup-policy.service.js";

const prisma = vi.hoisted(() => ({
  followUpPolicy: {
    findMany: vi.fn<() => Promise<FollowUpPolicy[]>>(),
    findFirst: vi.fn<() => Promise<FollowUpPolicy | null>>(),
    create: vi.fn<() => Promise<FollowUpPolicy>>(),
    update: vi.fn<() => Promise<FollowUpPolicy>>()
  },
  company: { findFirst: vi.fn<() => Promise<{ id: string } | null>>() },
  workspaceMember: { findFirst: vi.fn() },
  pipelineStage: { findFirst: vi.fn() },
  auditEvent: {
    create: vi.fn<(input: { data: { before?: unknown; after?: unknown } }) => Promise<unknown>>()
  },
  $transaction: vi.fn<(callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
}));
vi.mock("../../shared/prisma.js", () => ({ prisma }));
vi.mock("../realtime/realtime.service.js", () => ({ publishRealtimeEvent: vi.fn() }));

const context = {
  companyId: "company-1",
  service: "SEO",
  managerId: "manager-1",
  leadType: null,
  source: null,
  country: null,
  priority: null,
  campaign: null,
  pipelineStageId: null
};
const actor = {
  id: "manager-1",
  email: "manager@example.local",
  firstName: "Mira",
  lastName: "Manager",
  role: "SALES_MANAGER" as const,
  status: "ACTIVE" as const,
  activeWorkspaceId: "workspace-1",
  createdAt: new Date(),
  updatedAt: new Date()
};
function policy(overrides: Partial<FollowUpPolicy> = {}): FollowUpPolicy {
  return {
    id: "policy-1",
    workspaceId: "workspace-1",
    name: "SEO",
    enabled: true,
    isDefault: false,
    selectionPriority: 0,
    cadenceDays: [0, 2, 5],
    companyId: null,
    communicationPersonality: null,
    service: null,
    leadType: null,
    source: null,
    country: null,
    priority: null,
    managerId: null,
    campaign: null,
    pipelineStageId: null,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("follow-up policy communication personality", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
  });

  it("normalizes blank personality and rejects oversized instructions", () => {
    expect(
      createFollowUpPolicySchema.parse({
        name: "Default",
        cadenceDays: [0, 1],
        communicationPersonality: "  "
      }).communicationPersonality
    ).toBeNull();
    expect(
      updateFollowUpPolicySchema.parse({ communicationPersonality: "  Concise and warm  " })
    ).toEqual({ communicationPersonality: "Concise and warm" });
    expect(
      updateFollowUpPolicySchema.safeParse({ communicationPersonality: "x".repeat(2001) }).success
    ).toBe(false);
  });

  it("resolves company/service/manager specificity before priority and inherits past cadence-only rules", async () => {
    vi.mocked(prisma.followUpPolicy.findMany).mockResolvedValue([
      policy({ id: "default", isDefault: true, communicationPersonality: "Professional" }),
      policy({
        id: "service",
        service: "seo",
        selectionPriority: 100,
        communicationPersonality: "Warm"
      }),
      policy({
        id: "company-manager",
        companyId: "company-1",
        managerId: "manager-1",
        communicationPersonality: "Direct"
      }),
      policy({
        id: "cadence-only",
        companyId: "company-1",
        managerId: "manager-1",
        service: "SEO"
      }),
      policy({
        id: "other-company",
        companyId: "Company-1",
        service: "SEO",
        managerId: "manager-1",
        communicationPersonality: "Wrong"
      })
    ]);
    expect((await selectFollowUpPolicy("workspace-1", context)).id).toBe("cadence-only");
    expect(await resolveFollowUpCommunicationPersonality("workspace-1", context)).toBe("Direct");
    expect(prisma.followUpPolicy.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace-1", enabled: true } })
    );
  });

  it("uses priority for equally specific rules and falls back to the workspace personality", async () => {
    vi.mocked(prisma.followUpPolicy.findMany).mockResolvedValue([
      policy({ service: "SEO", communicationPersonality: "Warm" }),
      policy({ managerId: "manager-1", selectionPriority: 10, communicationPersonality: "Brief" }),
      policy({ isDefault: true, communicationPersonality: "Professional" })
    ]);
    expect(await resolveFollowUpCommunicationPersonality("workspace-1", context)).toBe("Brief");
    expect(
      await resolveFollowUpCommunicationPersonality("workspace-1", {
        ...context,
        service: "Other",
        managerId: null
      })
    ).toBe("Professional");
    vi.mocked(prisma.followUpPolicy.findMany).mockResolvedValue([policy()]);
    expect(await resolveFollowUpCommunicationPersonality("workspace-1", context)).toBeNull();
  });

  it("preserves callers without a company selector", async () => {
    const legacyContext: FollowUpPolicyContext = { ...context };
    delete legacyContext.companyId;
    vi.mocked(prisma.followUpPolicy.findMany).mockResolvedValue([
      policy({ companyId: "company-1", communicationPersonality: "Company-specific" }),
      policy({ isDefault: true, communicationPersonality: "Workspace default" })
    ]);
    expect(await resolveFollowUpCommunicationPersonality("workspace-1", legacyContext)).toBe(
      "Workspace default"
    );
  });

  it("rejects a company outside the active workspace before creating a policy", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null);
    await expect(
      createFollowUpPolicy(
        actor,
        createFollowUpPolicySchema.parse({ name: "Scoped", companyId: "foreign", cadenceDays: [0, 1] })
      )
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", workspaceId: "workspace-1" },
      select: { id: true }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists and audits personality changes and explicit clearing", async () => {
    const existing = policy({ communicationPersonality: "Warm" });
    vi.mocked(prisma.followUpPolicy.findFirst).mockResolvedValue(existing);
    vi.mocked(prisma.followUpPolicy.update).mockResolvedValue({
      ...existing,
      communicationPersonality: null
    });
    const result = await updateFollowUpPolicy(actor, existing.id, {
      communicationPersonality: null
    });
    expect(result.communicationPersonality).toBeNull();
    expect(prisma.followUpPolicy.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { communicationPersonality: null }
    });
    const auditData = prisma.auditEvent.create.mock.calls[0]?.[0].data;
    expect(auditData?.before).toMatchObject({ communicationPersonality: "Warm" });
    expect(auditData?.after).toMatchObject({ communicationPersonality: null });
  });
});
