import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { getApiConfig } from "@shilabs/shared-config";
import type { HealthResponse } from "@shilabs/shared-types";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { companyRoutes } from "./modules/companies/company.routes.js";
import { contactRoutes } from "./modules/contacts/contact.routes.js";
import { leadRoutes } from "./modules/leads/lead.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

const startedAt = new Date();

export function createApp(): Express {
  const app = express();
  const config = getApiConfig();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: false
    })
  );
  app.use(express.json());

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
  app.use("/api/users", userRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/contacts", contactRoutes);
  app.use("/api/leads", leadRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
