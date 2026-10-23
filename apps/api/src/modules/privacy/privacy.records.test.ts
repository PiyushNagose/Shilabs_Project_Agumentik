import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { contentRemaining, erasureRules, modelFields, redactionData, scope } from "./privacy.records.js";
import { policySchema } from "./privacy.schemas.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing privacy contract fixture");
  return value;
}

describe("privacy record contracts", () => {
  it("validates every field, tenant relation and enum filter against the generated schema", () => {
    for (const rule of erasureRules) {
      expect(() => redactionData(rule, true)).not.toThrow();
      expect(() => contentRemaining(rule)).not.toThrow();
      let model = rule.model;
      for (const key of rule.path === "$lead" ? [] : rule.path.split(".").filter(Boolean)) {
        const field = modelFields(model).find((field) => field.name === key);
        expect(field?.kind, `${rule.model}.${key}`).toBe("object");
        model = required(field).type;
      }
      expect(modelFields(model).some((field) => field.name === "workspaceId"), model).toBe(true);
      const status = rule.eligible?.status as { in?: string[]; notIn?: string[]; not?: string } | undefined;
      if (status) {
        const field = required(modelFields(rule.model).find((field) => field.name === "status"));
        const values = required(Prisma.dmmf.datamodel.enums.find((item) => item.name === field.type)).values.map((item) => item.name);
        for (const value of status.in ?? status.notIn ?? [status.not]) expect(values).toContain(value);
      }
    }
  });
  it("scopes direct and nested records and refuses unlinked opaque records", () => {
    const message = required(erasureRules.find((rule) => rule.model === "Message"));
    expect(scope(message, "workspace-a", "contact-a")).toEqual({ AND: [
      { workspaceId: "workspace-a" }, { conversation: { lead: { workspaceId: "workspace-a", contactId: "contact-a" } } }
    ] });
    expect(scope(required(erasureRules.find((rule) => rule.model === "AuditEvent")), "workspace-a", "contact-a")).toEqual({ id: { in: [] } });
  });
  it("redacts personal payloads without changing audit structure", () => {
    expect(redactionData(required(erasureRules.find((rule) => rule.model === "AuditEvent")), true)).toEqual({ before: { redacted: true }, after: { redacted: true }, metadata: { redacted: true } });
    const email = redactionData(required(erasureRules.find((rule) => rule.model === "OutboundEmail")), true);
    expect(email).toMatchObject({ toEmail: "[redacted]", ccEmails: [], attachmentMetadata: { redacted: true } });
    expect(email).not.toHaveProperty("id");
    expect(email).not.toHaveProperty("createdAt");
  });
  it("rejects unknown categories, unsafe periods and coercion", () => {
    for (const periods of [{ email: 0 }, { calls: -1 }, { audit: 1.5 }, { email: "30" }, { secrets: 1 }]) {
      expect(policySchema.safeParse({ enabled: false, revision: 0, periods }).success).toBe(false);
    }
    expect(policySchema.parse({ enabled: false, revision: 0, periods: {} }).enabled).toBe(false);
  });
});
