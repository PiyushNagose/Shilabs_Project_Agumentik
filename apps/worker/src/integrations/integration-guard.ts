import type { IntegrationProvider } from "@prisma/client";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";

export async function assertWorkspaceIntegrationEnabled(input: {
  workspaceId: string;
  provider: IntegrationProvider;
  key?: string;
}): Promise<void> {
  const connection = await workerPrisma.integrationAccount.findUnique({
    where: {
      workspaceId_provider_key: {
        workspaceId: input.workspaceId,
        provider: input.provider,
        key: input.key ?? "default"
      }
    },
    select: { status: true }
  });
  if (connection?.status === "DISABLED") {
    throw new PermanentDomainEventError(
      "INTEGRATION_DISABLED",
      "The required workspace integration is disabled"
    );
  }
}
