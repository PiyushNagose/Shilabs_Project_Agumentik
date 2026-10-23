import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../middleware/error.middleware.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { resolveWorkspaceContext } from "../workspaces/workspace.service.js";
import { isInternalRealtimePublishAuthorized } from "../realtime/realtime.service.js";
import { applyPrivacyCleanup, eraseContactData, exportContactData, getPrivacyPolicy, runDueWorkspaceRetention } from "./privacy.service.js";
import { internalPrivacyRoutes, privacyRoutes } from "./privacy.routes.js";

vi.mock("../auth/auth.service.js", () => ({ verifyAccessToken: vi.fn() }));
vi.mock("../workspaces/workspace.service.js", () => ({ resolveWorkspaceContext: vi.fn() }));
vi.mock("../realtime/realtime.service.js", () => ({ isInternalRealtimePublishAuthorized: vi.fn() }));
vi.mock("./privacy.service.js", () => ({
  getPrivacyPolicy: vi.fn(), savePrivacyPolicy: vi.fn(), previewPrivacyCleanup: vi.fn(),
  applyPrivacyCleanup: vi.fn(), exportContactData: vi.fn(), eraseContactData: vi.fn(), runDueWorkspaceRetention: vi.fn()
}));
const app = express();
app.use(express.json());
app.use("/api/privacy/internal", internalPrivacyRoutes);
app.use("/api/privacy", privacyRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyAccessToken).mockResolvedValue({ id: "user-a", role: "ADMIN", status: "ACTIVE", email: "admin@example.local", firstName: "Admin", lastName: "User", createdAt: new Date(), updatedAt: new Date() });
  vi.mocked(resolveWorkspaceContext).mockResolvedValue({ workspaceId: "workspace-a", workspaceName: "Workspace A", role: "ADMIN", memberId: "member-a" });
  vi.mocked(getPrivacyPolicy).mockResolvedValue({ enabled: false, revision: 0, periods: {} });
  vi.mocked(runDueWorkspaceRetention).mockResolvedValue({ results: [], limit: 5 });
});

describe("isolated privacy HTTP contracts", () => {
  it("requires auth for workspace privacy routes", async () => {
    await request(app).get("/api/privacy/policy").expect(401);
    expect(getPrivacyPolicy).not.toHaveBeenCalled();
  });
  it("passes the resolved workspace, disables caching and restricts active roles", async () => {
    await request(app).get("/api/privacy/policy").set("Authorization", "Bearer valid").expect("Cache-Control", "no-store").expect(200);
    expect(getPrivacyPolicy).toHaveBeenCalledWith(expect.objectContaining({ activeWorkspaceId: "workspace-a" }));
    vi.mocked(resolveWorkspaceContext).mockResolvedValue({ workspaceId: "workspace-a", workspaceName: "Workspace A", role: "VIEWER", memberId: "member-a" });
    await request(app).get("/api/privacy/policy").set("Authorization", "Bearer valid").expect(403);
  });
  it("allows manager exports but reserves erasure and policy changes for admins", async () => {
    vi.mocked(resolveWorkspaceContext).mockResolvedValue({ workspaceId: "workspace-a", workspaceName: "Workspace A", role: "SALES_MANAGER", memberId: "member-a" });
    await request(app).get("/api/privacy/contacts/contact-a/export").set("Authorization", "Bearer valid").expect(200);
    expect(exportContactData).toHaveBeenCalledWith(expect.objectContaining({ activeWorkspaceId: "workspace-a" }), "contact-a");
    await request(app).post("/api/privacy/contacts/contact-a/erase").set("Authorization", "Bearer valid").send({ confirmation: "ERASE CONTACT" }).expect(403);
    expect(eraseContactData).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation before destructive operations", async () => {
    await request(app).post("/api/privacy/cleanup/apply").set("Authorization", "Bearer valid").send({ previewId: "preview-a" }).expect(400);
    await request(app).post("/api/privacy/contacts/contact-a/erase").set("Authorization", "Bearer valid").send({ confirmation: "wrong" }).expect(400);
    expect(applyPrivacyCleanup).not.toHaveBeenCalled();
    expect(eraseContactData).not.toHaveBeenCalled();
  });
  it("checks internal secret before user authentication and never invokes retention on rejection", async () => {
    vi.mocked(isInternalRealtimePublishAuthorized).mockReturnValue(false);
    await request(app).post("/api/privacy/internal/run-due").set("x-shilabs-realtime-secret", "wrong").expect(401);
    expect(runDueWorkspaceRetention).not.toHaveBeenCalled();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
  it("accepts authorized internal runs without a fake user", async () => {
    vi.mocked(isInternalRealtimePublishAuthorized).mockReturnValue(true);
    await request(app).post("/api/privacy/internal/run-due").set("x-shilabs-realtime-secret", "internal-secret").expect(200);
    expect(isInternalRealtimePublishAuthorized).toHaveBeenCalledWith("internal-secret");
    expect(runDueWorkspaceRetention).toHaveBeenCalledWith();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
