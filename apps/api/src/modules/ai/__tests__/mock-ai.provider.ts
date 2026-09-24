import type { AIProvider } from "../ai.provider.js";

// Test-only dependency injection; no runtime factory can select this provider.
export class MockAIProvider implements AIProvider {
  public constructor(private readonly implementation: AIProvider) {}
  public generateSalesReply: AIProvider["generateSalesReply"] = (input) =>
    this.implementation.generateSalesReply(input);
  public extractQualification: AIProvider["extractQualification"] = (input) =>
    this.implementation.extractQualification(input);
  public summarizeLead: AIProvider["summarizeLead"] = (input) =>
    this.implementation.summarizeLead(input);
  public generateFollowUp: AIProvider["generateFollowUp"] = (input) =>
    this.implementation.generateFollowUp(input);
  public generateProposalDraft: AIProvider["generateProposalDraft"] = (input) =>
    this.implementation.generateProposalDraft(input);
  public understandReply: AIProvider["understandReply"] = (input) =>
    this.implementation.understandReply(input);
  public generateBriefing: AIProvider["generateBriefing"] = (input) =>
    this.implementation.generateBriefing(input);
  public createEmbedding: AIProvider["createEmbedding"] = (text) =>
    this.implementation.createEmbedding(text);
}
