import { createHash } from "node:crypto";
import type { AIProvider, SalesReplyInput } from "../modules/ai/ai.provider.js";
import type { CalendarProvider } from "../modules/calendar/calendar.provider.js";

export const adapterMetadata = {
  mode: "TEST_ADAPTERS",
  ai: "deterministic grounded test provider",
  calendar: "local test calendar; no Google invitation was sent",
  email: "real local Mailpit SMTP",
  externalCredentialsVerified: false
} as const;

function prospectEvidence(input: SalesReplyInput) {
  return input.messages
    .filter((message) => message.senderType === "PROSPECT")
    .map((message) => ({ messageId: message.id, quote: message.body }));
}

export const aiCalls: string[] = [];

export const browserAIProvider: AIProvider = {
  generateSalesReply(input) {
    aiCalls.push("generateSalesReply");
    return Promise.resolve({
      body: `Thank you for sharing your requirements. We can review these together in discovery. ${input.messages.length ? "Your message has been recorded for the team." : "Please share your current CRM requirements."}`,
      requiresHumanReview: true,
      reason: "Test adapter: a manager must review customer commitments"
    });
  },
  extractQualification(input) {
    aiCalls.push("extractQualification");
    const evidence = prospectEvidence(input);
    const text = evidence.map((item) => item.quote).join(" ");
    const hasScope = text.includes("15,000 contacts");
    return Promise.resolve({
      need: hasScope ? "CRM migration from Zoho Bigin and spreadsheets" : null,
      requirement: hasScope ? "600 leads each month; migrate around 15,000 contacts" : null,
      budget: null,
      budgetBand: null,
      authority: null,
      timeline: text.includes("February 2027")
        ? "February 2027 target, subject to human approval"
        : null,
      businessFit: null,
      decisionMakerIdentified: null,
      urgency: null,
      evidence
    });
  },
  summarizeLead(input) {
    aiCalls.push("summarizeLead");
    return Promise.resolve({
      summary:
        prospectEvidence(input)
          .map((item) => item.quote)
          .join(" ") || "No saved prospect reply",
      buyingSignals: [],
      objections: [],
      risks: [],
      suggestedNextAction: "Review saved customer evidence"
    });
  },
  generateFollowUp(input) {
    aiCalls.push("generateFollowUp");
    const context = JSON.parse(input.leadContext) as { stepIndex?: number };
    const objectives = ["CRM discovery", "scope review", "rollout planning", "next-step confirmation"];
    const objective = objectives[context.stepIndex ?? 0] ?? "next-step confirmation";
    const humanContext = input.messages.filter((message) => message.senderType === "USER").at(-1)?.body.slice(0, 110) ?? "your CRM requirements";
    return Promise.resolve({
      body: `Following up on ${objective}. Our team's last update was: ${humanContext}. Please share a suitable time to review the next step. Regards, Shilabs Sales`,
      requiresHumanReview: false,
      reason: null
    });
  },
  generateProposalDraft(input) {
    aiCalls.push("generateProposalDraft");
    return Promise.resolve({
      title: "CRM discovery proposal for human review",
      serviceType: "CRM implementation",
      content:
        "Discovery scope based on saved customer communication. Pricing, discounts, legal terms and delivery commitments require written human approval. No discount is approved.",
      usedKnowledgeIds: input.approvedKnowledge.map((item) => item.id),
      evidence: input.approvedKnowledge.map((item) => ({ sourceId: item.id, quote: item.content })),
      requiresHumanReview: true,
      missingInformation: ["Approved price", "Approved delivery commitment"]
    });
  },
  understandReply(input) {
    aiCalls.push("understandReply");
    const evidence = prospectEvidence(input);
    const text = evidence.map((item) => item.quote).join(" ");
    const negotiation = /discount|best price|guarantee/i.test(text);
    return Promise.resolve({
      intent: negotiation ? "NEGOTIATION" : "QUESTION",
      confidence: 1,
      summary: negotiation
        ? "Customer requests pricing, a discount and delivery guarantee; manager approval required"
        : "Customer asks for discovery information",
      draftResponse: null,
      requiresHumanReview: true,
      recommendedAction: "HUMAN_HANDOFF",
      evidence,
      usedKnowledgeIds: []
    });
  },
  generateBriefing(input) {
    aiCalls.push("generateBriefing");
    return Promise.resolve({
      summary: "Test adapter briefing grounded in saved customer communication",
      requirements: null,
      budget: null,
      timeline: null,
      decisionContext: null,
      recentCommunication:
        prospectEvidence(input)
          .map((item) => item.quote)
          .join(" ") || "No prospect reply",
      qualification: null,
      proposalDealContext: null,
      meetingContext: null,
      recommendedNextAction: "Review saved customer evidence",
      usedKnowledgeIds: [],
      evidence: prospectEvidence(input).map((item) => ({
        sourceId: item.messageId,
        quote: item.quote
      })),
      requiresHumanReview: true,
      unknowns: ["Approved commercial terms"]
    });
  },
  createEmbedding(text) {
    aiCalls.push("createEmbedding");
    return Promise.resolve(
      [...createHash("sha256").update(text).digest()].map((value) => value / 255)
    );
  }
};

export const calendarCalls: string[] = [];

export const browserCalendarProvider: CalendarProvider = {
  rescheduleMeeting() {
    calendarCalls.push("rescheduleMeeting");
    return Promise.resolve({ status: "SYNCED", lastError: null });
  },
  cancelMeeting() {
    calendarCalls.push("cancelMeeting");
    return Promise.resolve({ status: "SYNCED", lastError: null });
  },
  getHealth() {
    calendarCalls.push("getHealth");
    return Promise.resolve({
      provider: "GOOGLE",
      status: "CONFIGURED",
      configured: true,
      checkedAt: new Date().toISOString(),
      defaultTimeZone: "Asia/Kolkata",
      missingConfig: [],
      lastError: null
    });
  },
  getAvailability(input) {
    calendarCalls.push("getAvailability");
    const slots = [];
    const duration = input.slotMinutes * 60_000;
    for (
      let start = input.windowStart.getTime();
      start + duration <= input.windowEnd.getTime();
      start += duration
    ) {
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + duration).toISOString(),
        timeZone: input.timeZone
      });
    }
    return Promise.resolve({
      provider: "GOOGLE",
      status: "AVAILABLE",
      checkedAt: new Date().toISOString(),
      timeZone: input.timeZone,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      slotMinutes: input.slotMinutes,
      slots,
      unavailableReason: null
    });
  },
  createMeeting(input) {
    calendarCalls.push("createMeeting");
    const id = `test-calendar-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 20)}`;
    return Promise.resolve({
      provider: "GOOGLE",
      status: "SYNCED",
      externalMeetingId: id,
      externalMeetingUrl: `http://127.0.0.1/test-calendar/${id}`,
      externalCalendarId: "test-adapter-calendar",
      organizerEmail: "calendar@test.local",
      lastError: null
    });
  }
};
