import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { getVoiceConfig, type VoiceConfig } from "@shilabs/shared-config";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { explicitNegotiationSignals } from "../reply-processing/reply-policy.js";
import type { VoiceTranscriptTurn } from "./voice-ai.service.js";

export interface VoiceAiSession {
  acceptAudio(payload: string): void;
  close(): Promise<void>;
}

export interface VoiceAiSessionInput {
  providerCallId: string;
  instructions: string;
  onAudio: (payload: string) => void;
  onTranscript: (turn: VoiceTranscriptTurn) => void;
  env?: NodeJS.ProcessEnv;
}

export interface VoiceAIProvider {
  startSession(input: VoiceAiSessionInput): Promise<VoiceAiSession>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rawDataToUtf8(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

export class OpenAIRealtimeVoiceAIProvider implements VoiceAIProvider {
  public constructor(private readonly config: VoiceConfig = getVoiceConfig()) {}

  public startSession(input: VoiceAiSessionInput): Promise<VoiceAiSession> {
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.voiceAi.model)}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.voiceAi.openaiApiKey}`
        }
      }
    );
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            model: this.config.voiceAi.model,
            instructions: input.instructions,
            audio: {
              input: {
                format: { type: "audio/pcm", rate: this.config.voiceAi.sampleRate },
                transcription: { model: "gpt-4o-mini-transcribe" },
                turn_detection: { type: "server_vad" }
              },
              output: {
                format: { type: "audio/pcm", rate: this.config.voiceAi.sampleRate },
                voice: this.config.voiceAi.voice
              }
            }
          }
        })
      );
      socket.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: "Greet the customer, identify Shilabs, and ask if they have a minute to talk.",
            modalities: ["audio", "text"]
          }
        })
      );
    });
    socket.on("message", (data) => {
      const event = parseJsonLine(rawDataToUtf8(data));
      if (!event) return;
      const type = stringValue(event.type);
      if (type === "response.output_audio.delta") {
        const delta = stringValue(event.delta);
        if (delta) input.onAudio(delta);
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const transcript = stringValue(event.transcript);
        if (transcript) input.onTranscript({ speaker: "customer", text: transcript, at: nowIso() });
      }
      if (type === "response.output_audio_transcript.done") {
        const transcript = stringValue(event.transcript);
        if (transcript) input.onTranscript({ speaker: "assistant", text: transcript, at: nowIso() });
      }
    });

    return Promise.resolve({
      acceptAudio: (payload) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
        }
      },
      close: () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
        return Promise.resolve();
      }
    });
  }
}

function scriptPath(): string {
  const current = fileURLToPath(import.meta.url);
  return path.resolve(current, "../../../../scripts/local_vosk_stt.py");
}

function writeSttChunk(process: ChildProcessWithoutNullStreams, chunk: Buffer): void {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.byteLength, 0);
  process.stdin.write(Buffer.concat([header, chunk]));
}

function extractWavPcm(buffer: Buffer): Buffer {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Windows TTS did not produce a WAV file");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === "data") return buffer.subarray(dataStart, dataStart + chunkSize);
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  throw new Error("Windows TTS WAV file did not contain audio data");
}

async function synthesizeWithWindowsSapi(input: {
  text: string;
  sampleRate: number;
  voiceName: string;
}): Promise<Buffer> {
  const tempDir = path.join(os.tmpdir(), `shilabs-voice-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const textPath = path.join(tempDir, "speech.txt");
  const wavPath = path.join(tempDir, "speech.wav");
  await writeFile(textPath, input.text, "utf8");
  const command = [
    "Add-Type -AssemblyName System.Speech;",
    `$text = Get-Content -Raw -LiteralPath '${textPath.replace(/'/gu, "''")}';`,
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    input.voiceName ? `$s.SelectVoice('${input.voiceName.replace(/'/gu, "''")}');` : "",
    `$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${String(input.sampleRate)}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);`,
    `$s.SetOutputToWaveFile('${wavPath.replace(/'/gu, "''")}', $fmt);`,
    "$s.Speak($text);",
    "$s.Dispose();"
  ].join(" ");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Windows TTS failed with exit code ${String(code)}`));
    });
  });
  try {
    return extractWavPcm(await readFile(wavPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function sendPcmChunks(input: { pcm: Buffer; onAudio: (payload: string) => void; sampleRate: number }): void {
  const chunkBytes = Math.max(640, Math.floor(input.sampleRate * 2 * 0.1));
  for (let offset = 0; offset < input.pcm.length; offset += chunkBytes) {
    input.onAudio(input.pcm.subarray(offset, offset + chunkBytes).toString("base64"));
  }
}

function hasNegotiationSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return explicitNegotiationSignals.some((signal) => normalized.includes(signal));
}

export class LocalVoskWindowsVoiceAIProvider implements VoiceAIProvider {
  public constructor(
    private readonly config: VoiceConfig = getVoiceConfig(),
    private readonly aiProvider: AIProvider = createAIProvider()
  ) {}

  public startSession(input: VoiceAiSessionInput): Promise<VoiceAiSession> {
    if (!this.config.voiceAi.localVoskModelPath) {
      throw new Error("VOICE_AI_LOCAL_VOSK_MODEL_PATH is required for local_vosk_windows");
    }
    const stt = spawn(
      this.config.voiceAi.localPythonCommand,
      [
        scriptPath(),
        "--model",
        this.config.voiceAi.localVoskModelPath,
        "--sample-rate",
        String(this.config.voiceAi.sampleRate)
      ],
      { windowsHide: true }
    );
    const turns: VoiceTranscriptTurn[] = [];
    let stdout = "";
    let speaking = Promise.resolve();

    const speak = (text: string): void => {
      const responseTurn: VoiceTranscriptTurn = { speaker: "assistant", text, at: nowIso() };
      turns.push(responseTurn);
      input.onTranscript(responseTurn);
      speaking = speaking
        .then(async () => {
          const pcm = await synthesizeWithWindowsSapi({
            text,
            sampleRate: this.config.voiceAi.sampleRate,
            voiceName: this.config.voiceAi.localTtsVoiceName
          });
          sendPcmChunks({ pcm, onAudio: input.onAudio, sampleRate: this.config.voiceAi.sampleRate });
        })
        .catch(() => undefined);
    };

    const replyToCustomer = (text: string): void => {
      const customerTurn: VoiceTranscriptTurn = { speaker: "customer", text, at: nowIso() };
      turns.push(customerTurn);
      input.onTranscript(customerTurn);
      if (hasNegotiationSignal(text)) {
        speak("I understand. I will ask your Shilabs owner to follow up on the commercial terms.");
        return;
      }
      void (async () => {
        const approvedKnowledge = await listApprovedKnowledge({ limit: 10 });
        const result = await this.aiProvider.generateSalesReply({
          messages: turns.map((turn, index) => ({
            id: `voice-turn-${String(index)}`,
            senderType: turn.speaker === "customer" ? "PROSPECT" : "AI",
            body: turn.text
          })),
          leadContext: input.instructions,
          approvedKnowledge: approvedKnowledge.map((item) => ({
            id: item.versionId,
            content: item.content
          }))
        });
        speak(result.requiresHumanReview ? "I will have a Shilabs teammate follow up with you." : result.body);
      })().catch(() => {
        speak("I am sorry, I could not process that clearly. A Shilabs teammate will follow up with you.");
      });
    };

    stt.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      let newline = stdout.indexOf("\n");
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        const event = parseJsonLine(line);
        const text = event?.type === "final" ? stringValue(event.text) : null;
        if (text) replyToCustomer(text);
        newline = stdout.indexOf("\n");
      }
    });

    speak("Hello, this is Shilabs AI Sales Engine. Do you have a minute to talk?");

    return Promise.resolve({
      acceptAudio: (payload) => {
        writeSttChunk(stt, Buffer.from(payload, "base64"));
      },
      close: async () => {
        const closed = new Promise<void>((resolve) => {
          let settled = false;
          const settle = (): void => {
            if (settled) return;
            settled = true;
            resolve();
          };
          stt.once("close", settle);
          setTimeout(settle, 1500).unref();
        });
        writeSttChunk(stt, Buffer.alloc(0));
        stt.stdin.end();
        await closed;
        await speaking;
        if (!stt.killed) stt.kill();
      }
    });
  }
}

export function createVoiceAIProvider(config: VoiceConfig = getVoiceConfig()): VoiceAIProvider {
  if (config.voiceAi.provider === "local_vosk_windows") {
    return new LocalVoskWindowsVoiceAIProvider(config);
  }
  return new OpenAIRealtimeVoiceAIProvider(config);
}
