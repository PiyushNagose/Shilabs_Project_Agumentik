import { AgentStatus, AgentType } from "@prisma/client";
import { workerPrisma } from "../domain-events/domain-event.repository.js";

export async function isAgentCapabilityActive(
  workspaceId: string,
  type: AgentType
): Promise<boolean> {
  const [total, active] = await Promise.all([
    workerPrisma.agent.count({ where: { workspaceId, type } }),
    workerPrisma.agent.count({ where: { workspaceId, type, status: AgentStatus.ACTIVE } })
  ]);
  return total === 0 || active > 0;
}
