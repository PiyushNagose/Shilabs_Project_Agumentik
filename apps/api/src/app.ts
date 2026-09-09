import express, { type Express, type Request, type Response } from "express";
import { getApiConfig } from "@shilabs/shared-config";
import type { HealthResponse } from "@shilabs/shared-types";

const startedAt = new Date();

export function createApp(): Express {
  const app = express();
  const config = getApiConfig();

  app.disable("x-powered-by");
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

  return app;
}
