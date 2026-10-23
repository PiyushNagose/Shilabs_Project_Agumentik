import { Prisma, type FollowUpPolicy } from "@prisma/client";
import type { FollowUpPolicyCriteriaDto, FollowUpPolicyDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type {
  CreateFollowUpPolicyInput,
  UpdateFollowUpPolicyInput
} from "./followup-policy.schemas.js";

const SAFE_DEFAULT_POLICY_NAME = "Default follow-up";
const SAFE_DEFAULT_CADENCE_DAYS = [0, 1, 5, 9] as const;
const selectorKeys = [
  "companyId",
  "service",
  "leadType",
  "source",
  "country",
  "priority",
  "managerId",
  "campaign",
  "pipelineStageId"
] as const;

type SelectorKey = (typeof selectorKeys)[number];
export type FollowUpPolicyContext = Record<Exclude<SelectorKey, "companyId">, string | null> & {
  companyId?: string | null;
};

function workspaceIdFor(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  }
  return actor.activeWorkspaceId;
}

function assertCanManage(actor: AuthenticatedUser): void {
  if (!isWorkspaceManager(actor)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions");
  }
}

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLocaleLowerCase() ?? "";
  return result.length > 0 ? result : null;
}

function criteria(policy: Pick<FollowUpPolicy, SelectorKey>): FollowUpPolicyCriteriaDto {
  return Object.fromEntries(
    selectorKeys.map((key) => [key, policy[key]])
  ) as unknown as FollowUpPolicyCriteriaDto;
}

function dto(policy: FollowUpPolicy): FollowUpPolicyDto {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    name: policy.name,
    enabled: policy.enabled,
    isDefault: policy.isDefault,
    selectionPriority: policy.selectionPriority,
    ...criteria(policy),
    cadenceDays: [...policy.cadenceDays],
    communicationPersonality: policy.communicationPersonality,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

function specificity(policy: FollowUpPolicy): number {
  return selectorKeys.reduce((count, key) => count + (normalized(policy[key]) ? 1 : 0), 0);
}

function matches(policy: FollowUpPolicy, context: FollowUpPolicyContext): boolean {
  return selectorKeys.every((key) => {
    if (key === "companyId" || key === "managerId" || key === "pipelineStageId") {
      return !policy[key] || policy[key] === context[key];
    }
    const expected = normalized(policy[key]);
    return expected === null || expected === normalized(context[key]);
  });
}

function comparePolicies(left: FollowUpPolicy, right: FollowUpPolicy): number {
  return (
    specificity(right) - specificity(left) ||
    right.selectionPriority - left.selectionPriority ||
    left.createdAt.getTime() - right.createdAt.getTime()
  );
}

async function validateReferences(
  workspaceId: string,
  input: Pick<CreateFollowUpPolicyInput, "companyId" | "managerId" | "pipelineStageId">
): Promise<void> {
  const [manager, stage, company] = await Promise.all([
    input.managerId
      ? prisma.workspaceMember.findFirst({
          where: { workspaceId, userId: input.managerId, status: "ACTIVE" },
          select: { id: true }
        })
      : null,
    input.pipelineStageId
      ? prisma.pipelineStage.findFirst({
          where: { id: input.pipelineStageId, workspaceId, status: "ACTIVE" },
          select: { id: true }
        })
      : null,
    input.companyId
      ? prisma.company.findFirst({
          where: { id: input.companyId, workspaceId },
          select: { id: true }
        })
      : null
  ]);
  if (input.companyId && !company) {
    throw new AppError(422, "VALIDATION_ERROR", "Policy company must belong to this workspace");
  }
  if (input.managerId && !manager) {
    throw new AppError(422, "VALIDATION_ERROR", "Policy manager must belong to this workspace");
  }
  if (input.pipelineStageId && !stage) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Policy pipeline stage must belong to this workspace"
    );
  }
}

function assertDefaultHasNoSelectors(input: Partial<Record<SelectorKey, string | null>>): void {
  if (selectorKeys.some((key) => normalized(input[key]) !== null)) {
    throw new AppError(422, "VALIDATION_ERROR", "The default policy cannot have match criteria");
  }
}

async function audit(
  workspaceId: string,
  actor: AuthenticatedUser,
  policyId: string,
  action: string,
  before: Prisma.InputJsonValue | undefined,
  after: Prisma.InputJsonValue | undefined
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "FOLLOW_UP_POLICY",
      sourceId: policyId,
      entityType: "FollowUpPolicy",
      entityId: policyId,
      action,
      before,
      after
    }
  });
}

async function notify(workspaceId: string, action: string): Promise<void> {
  await publishRealtimeEvent({ entityType: "workspace", action, workspaceId });
}

export async function ensureDefaultFollowUpPolicy(workspaceId: string): Promise<FollowUpPolicy> {
  const existing = await prisma.followUpPolicy.findFirst({
    where: { workspaceId, enabled: true, isDefault: true },
    orderBy: [{ selectionPriority: "desc" }, { createdAt: "asc" }]
  });
  if (existing) return existing;
  return prisma.followUpPolicy.upsert({
    where: { workspaceId_name: { workspaceId, name: SAFE_DEFAULT_POLICY_NAME } },
    create: {
      workspaceId,
      name: SAFE_DEFAULT_POLICY_NAME,
      enabled: true,
      isDefault: true,
      cadenceDays: [...SAFE_DEFAULT_CADENCE_DAYS]
    },
    update: { enabled: true, isDefault: true }
  });
}

export async function selectFollowUpPolicy(
  workspaceId: string,
  context: FollowUpPolicyContext
): Promise<FollowUpPolicy> {
  const policies = await prisma.followUpPolicy.findMany({
    where: { workspaceId, enabled: true },
    orderBy: [{ selectionPriority: "desc" }, { createdAt: "asc" }]
  });
  const selected = policies
    .filter((policy) => !policy.isDefault && matches(policy, context))
    .sort(comparePolicies)[0];
  return (
    selected ??
    policies.find((policy) => policy.isDefault) ??
    ensureDefaultFollowUpPolicy(workspaceId)
  );
}

export async function resolveFollowUpCommunicationPersonality(
  workspaceId: string,
  context: FollowUpPolicyContext
): Promise<string | null> {
  const policies = await prisma.followUpPolicy.findMany({
    where: { workspaceId, enabled: true },
    orderBy: [{ selectionPriority: "desc" }, { createdAt: "asc" }]
  });
  const configured = policies.filter((policy) => policy.communicationPersonality?.trim());
  const selected =
    configured
      .filter((policy) => !policy.isDefault && matches(policy, context))
      .sort(comparePolicies)[0] ?? configured.find((policy) => policy.isDefault);
  return selected?.communicationPersonality?.trim() ?? null;
}

export async function listFollowUpPolicies(actor: AuthenticatedUser): Promise<FollowUpPolicyDto[]> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  await ensureDefaultFollowUpPolicy(workspaceId);
  return (
    await prisma.followUpPolicy.findMany({
      where: { workspaceId },
      orderBy: [{ isDefault: "desc" }, { selectionPriority: "desc" }, { name: "asc" }]
    })
  ).map(dto);
}

export async function createFollowUpPolicy(
  actor: AuthenticatedUser,
  input: CreateFollowUpPolicyInput
): Promise<FollowUpPolicyDto> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  if (input.isDefault) assertDefaultHasNoSelectors(input);
  await validateReferences(workspaceId, input);
  const policy = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.followUpPolicy.updateMany({
        where: { workspaceId, isDefault: true },
        data: { isDefault: false }
      });
    }
    return tx.followUpPolicy.create({ data: { workspaceId, ...input } });
  });
  await audit(
    workspaceId,
    actor,
    policy.id,
    "FOLLOW_UP_POLICY_CREATED",
    undefined,
    dto(policy) as unknown as Prisma.InputJsonValue
  );
  await notify(workspaceId, "follow-up-policy-created");
  return dto(policy);
}

export async function updateFollowUpPolicy(
  actor: AuthenticatedUser,
  policyId: string,
  input: UpdateFollowUpPolicyInput
): Promise<FollowUpPolicyDto> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  const existing = await prisma.followUpPolicy.findFirst({ where: { id: policyId, workspaceId } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Follow-up policy not found");
  const merged = { ...existing, ...input };
  if (merged.isDefault) {
    assertDefaultHasNoSelectors(merged);
    if (!merged.enabled) {
      throw new AppError(422, "VALIDATION_ERROR", "The default policy must remain enabled");
    }
  }
  await validateReferences(workspaceId, merged);
  const policy = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.followUpPolicy.updateMany({
        where: { workspaceId, isDefault: true, id: { not: policyId } },
        data: { isDefault: false }
      });
    }
    return tx.followUpPolicy.update({ where: { id: policyId }, data: input });
  });
  await audit(
    workspaceId,
    actor,
    policy.id,
    "FOLLOW_UP_POLICY_UPDATED",
    dto(existing) as unknown as Prisma.InputJsonValue,
    dto(policy) as unknown as Prisma.InputJsonValue
  );
  await notify(workspaceId, "follow-up-policy-updated");
  return dto(policy);
}

export async function deleteFollowUpPolicy(
  actor: AuthenticatedUser,
  policyId: string
): Promise<void> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  const existing = await prisma.followUpPolicy.findFirst({ where: { id: policyId, workspaceId } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Follow-up policy not found");
  if (existing.isDefault) {
    throw new AppError(409, "CONFLICT", "The default follow-up policy cannot be deleted");
  }
  await prisma.followUpPolicy.delete({ where: { id: policyId } });
  await audit(
    workspaceId,
    actor,
    policyId,
    "FOLLOW_UP_POLICY_DELETED",
    dto(existing) as unknown as Prisma.InputJsonValue,
    undefined
  );
  await notify(workspaceId, "follow-up-policy-deleted");
}

export function followUpPolicyCriteria(policy: FollowUpPolicy): FollowUpPolicyCriteriaDto {
  return criteria(policy);
}
