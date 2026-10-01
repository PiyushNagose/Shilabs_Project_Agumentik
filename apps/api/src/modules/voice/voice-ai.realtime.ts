import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Prisma } from "@prisma/client";
import { getVoiceConfig } from "@shilabs/shared-config";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import {
  finalizeVoiceConversationRun,
  startVoiceConversationRun,
  type VoiceTranscriptTurn
} from "./voice-ai.service.js";
import { createVoiceAIProvider, type VoiceAiSession } from "./voice-ai.provider.js";
import { prisma } from "../../shared/prisma.js";

type JsonRecord = Record<string, unknown>;

function parseJson(data: WebSocket.RawData): JsonRecord | null {
  try {
    const text =
      typeof data === "string"
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(data)).toString("utf8")
            : data.toString("utf8");
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(input: JsonRecord, key: string, nestedKey: string): string | null {
  const nested = input[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return stringValue((nested as JsonRecord)[nestedKey]);
}

function eventName(message: JsonRecord): string {
  return stringValue(message.event) ?? stringValue(message.type) ?? "";
}

function callSidFromMessage(message: JsonRecord, fallback: string | null): string | null {
  return (
    nestedString(message, "start", "call_sid") ??
    nestedString(message, "start", "callSid") ??
    nestedString(message, "stop", "call_sid") ??
    nestedString(message, "stop", "callSid") ??
    stringValue(message.CallSid) ??
    stringValue(message.call_sid) ??
    fallback
  );
}

function mediaPayload(message: JsonRecord): string | null {
  return nestedString(message, "media", "payload");
}

async function buildInstructions(providerCallId: string): Promise<string> {
  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId },
    include: {
      lead: {
        include: {
          company: true,
          contact: true,
          owner: true,
          qualification: { include: { evidence: true } }
        }
      }
    }
  });
  const approvedKnowledge = await listApprovedKnowledge({ limit: 10 });
  const lead = call?.lead;
  const leadContext = lead
    ? [
        `Company: ${lead.company.name}`,
        `Contact: ${`${lead.contact.firstName} ${lead.contact.lastName}`.trim()}`,
        `Requirement: ${lead.requirement ?? "unknown"}`,
        `Service interest: ${lead.serviceInterest ?? "unknown"}`,
        `Existing qualification: ${JSON.stringify(lead.qualification ?? {})}`
      ].join("\n")
    : "Lead context was not found yet. Keep the conversation short and factual.";
  const knowledge = approvedKnowledge
    .map((item) => `- [${item.versionId}] ${item.content}`)
    .join("\n");
  return [
    "You are Shilabs AI Sales Engine speaking on an outbound sales follow-up call.",
    "Keep responses concise, natural, and professional. Ask one question at a time.",
    "Use only the lead context and approved knowledge below. If you do not know, say you will have a teammate follow up.",
    "Do not negotiate pricing, discounts, contract terms, legal terms, or commercial concessions.",
    "If the customer asks to negotiate, reduce price, get a discount, or discuss commercial terms, acknowledge and say a human owner will follow up. Do not counteroffer.",
    "If the customer requests a meeting, collect preference at a high level but do not book a meeting.",
    "If the customer asks to stop contact, acknowledge and stop.",
    "",
    "Lead context:",
    leadContext,
    "",
    "Approved knowledge:",
    knowledge || "No approved knowledge is available."
  ].join("\n");
}

export function installExotelVoiceAiWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const config = getVoiceConfig();
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const streamPath = config.exotel.voicebotStreamPath.replace(/\/$/u, "");
    const pathname = url.pathname.replace(/\/$/u, "");
    const pathToken =
      pathname.startsWith(`${streamPath}/`) && pathname.length > streamPath.length + 1
        ? decodeURIComponent(pathname.slice(streamPath.length + 1))
        : null;
    if (pathname !== streamPath && !pathToken) return;
    const token = url.searchParams.get("token") ?? pathToken;
    if (!config.voiceAi.enabled || !config.voiceAi.streamToken || token !== config.voiceAi.streamToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    (request as IncomingMessage & { voiceAiUrl?: URL }).voiceAiUrl = url;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (exotelSocket: WebSocket, request: IncomingMessage) => {
    const url =
      (request as IncomingMessage & { voiceAiUrl?: URL }).voiceAiUrl ??
      new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    let providerCallId =
      url.searchParams.get("CallSid") ?? url.searchParams.get("Sid") ?? url.searchParams.get("call_sid");
    let streamSid: string | null = null;
    let voiceAiSession: VoiceAiSession | null = null;
    const turns: VoiceTranscriptTurn[] = [];
    let finalized = false;

    const finalize = (): void => {
      if (finalized || !providerCallId) return;
      finalized = true;
      void Promise.resolve(voiceAiSession?.close()).then(() =>
        finalizeVoiceConversationRun({ providerCallId: providerCallId ?? "", turns })
      );
    };

    exotelSocket.on("message", (data) => {
      const message = parseJson(data);
      if (!message) return;
      const name = eventName(message);
      providerCallId = callSidFromMessage(message, providerCallId);
      streamSid = nestedString(message, "start", "stream_sid") ?? stringValue(message.stream_sid) ?? streamSid;

      if (name === "start" && providerCallId) {
        void startVoiceConversationRun({
          providerCallId,
          payload: JSON.parse(JSON.stringify(message)) as Prisma.InputJsonObject
        }).then(async () => {
          const instructions = await buildInstructions(providerCallId ?? "");
          voiceAiSession = await createVoiceAIProvider().startSession({
            providerCallId: providerCallId ?? "",
            instructions,
            onTranscript: (turn) => turns.push(turn),
            onAudio: (payload) => {
              if (exotelSocket.readyState !== WebSocket.OPEN) return;
              exotelSocket.send(
                JSON.stringify({
                  event: "media",
                  stream_sid: streamSid,
                  media: { payload }
                })
              );
            }
          });
        });
        return;
      }

      if (name === "media") {
        const payload = mediaPayload(message);
        if (payload) voiceAiSession?.acceptAudio(payload);
        return;
      }

      if (name === "stop") {
        finalize();
      }
    });

    exotelSocket.on("close", finalize);
    exotelSocket.on("error", finalize);
  });
}
