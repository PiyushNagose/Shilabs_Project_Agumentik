/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { appPath, appRoutes, navigationByRole, parseAppRoute } from "./routing.js";

describe("app routing", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  it("maps every role navigation entry to a registered route", () => {
    for (const routeIds of Object.values(navigationByRole)) {
      for (const routeId of routeIds) expect(appRoutes[routeId].path).toMatch(/^\//);
    }
  });

  it("preserves lead and tab deep links", () => {
    window.history.replaceState(null, "", "/crm/leads/lead%2Fone?tab=Meetings");
    expect(parseAppRoute(navigationByRole.ADMIN)).toEqual({
      id: "crm",
      leadId: "lead/one",
      tab: "Meetings"
    });
    expect(appPath({ id: "crm", leadId: "lead/one", tab: "Meetings" })).toBe(
      "/crm/leads/lead%2Fone?tab=Meetings"
    );
  });

  it("does not hydrate a route unavailable to the current role", () => {
    window.history.replaceState(null, "", "/operations");
    expect(parseAppRoute(navigationByRole.SALES_REP)).toEqual({ id: "dashboard", leadId: null });
  });

  it("hydrates the Phase 4B contact and company workspaces", () => {
    window.history.replaceState(null, "", "/contacts");
    expect(parseAppRoute(navigationByRole.ADMIN)).toEqual({ id: "contacts", leadId: null });
    window.history.replaceState(null, "", "/companies");
    expect(parseAppRoute(navigationByRole.SALES_REP)).toEqual({ id: "companies", leadId: null });
  });

  it("preserves Phase 5 deal deep links", () => {
    window.history.replaceState(null, "", "/deals/deal%2Fone");
    expect(parseAppRoute(navigationByRole.ADMIN)).toEqual({ id: "deals", leadId: null, dealId: "deal/one" });
    expect(appPath({ id: "deals", leadId: null, dealId: "deal/one" })).toBe("/deals/deal%2Fone");
  });
});
