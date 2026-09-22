import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { getApiConfig } from "@shilabs/shared-config";
import type { ApiConfig } from "@shilabs/shared-config";
import type { HealthResponse } from "@shilabs/shared-types";
import { actionDashboardRoutes } from "./modules/action-dashboard/action-dashboard.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { companyRoutes } from "./modules/companies/company.routes.js";
import { contactRoutes } from "./modules/contacts/contact.routes.js";
import { conversationRoutes } from "./modules/conversations/conversation.routes.js";
import { dealRoutes } from "./modules/deals/deal.routes.js";
import { domainEventRoutes } from "./modules/domain-events/domain-events.routes.js";
import { emailRoutes } from "./modules/email/email.routes.js";
import { followUpRoutes } from "./modules/followups/followup.routes.js";
import { knowledgeBaseRoutes } from "./modules/knowledge-base/knowledge-base.routes.js";
import { leadRoutes } from "./modules/leads/lead.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { pipelineRoutes } from "./modules/pipeline/pipeline.routes.js";
import { proposalRoutes } from "./modules/proposals/proposal.routes.js";
import { replyProcessingRoutes } from "./modules/reply-processing/reply-processing.routes.js";
import { scoringRoutes } from "./modules/scoring/scoring.routes.js";
import { zohoBiginRoutes } from "./modules/integrations/zoho-bigin/zoho-bigin.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

const startedAt = new Date();

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(origin: string | undefined, config: ApiConfig): boolean {
  if (!origin || origin === config.webOrigin) {
    return true;
  }

  return config.nodeEnv === "development" && isLocalDevelopmentOrigin(origin);
}

export function createApp(): Express {
  const app = express();
  const config = getApiConfig();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isCorsOriginAllowed(origin, config));
      },
      credentials: false
    })
  );
  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
      }
    })
  );

  app.get("/health", (_request: Request, response: Response<HealthResponse>) => {
    response.status(200).json({
      status: "ok",
      service: "api",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  app.get("/ready", (_request: Request, response: Response<HealthResponse>) => {
    response.status(200).json({
      status: "ok",
      service: "api",
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      timestamp: new Date().toISOString()
    });
  });

  app.get("/", (_request: Request, response: Response) => {
    response.status(200).json({
      name: "Shilabs AI Sales Engine API",
      environment: config.nodeEnv
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/action-dashboard", actionDashboardRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/contacts", contactRoutes);
  app.use("/api/leads", leadRoutes);
  app.use("/api/deals", dealRoutes);
  app.use("/api/email", emailRoutes);
  app.use("/api/followups", followUpRoutes);
  app.use("/api/knowledge-base", knowledgeBaseRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/pipeline", pipelineRoutes);
  app.use("/api/proposals", proposalRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/reply-processing", replyProcessingRoutes);
  app.use("/api/domain-events", domainEventRoutes);
  app.use("/api/scoring", scoringRoutes);
  app.use("/api/integrations/zoho-bigin", zohoBiginRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
