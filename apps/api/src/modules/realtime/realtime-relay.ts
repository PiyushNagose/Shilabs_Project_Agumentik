import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { z } from "zod";

const envelopeSchema = z.object({
  sender: z.string(),
  event: z
    .object({
      type: z.literal("realtime:update"),
      entityType: z.string(),
      action: z.string(),
      workspaceId: z.string().min(1),
      occurredAt: z.string()
    })
    .loose()
});

export class RealtimeRelay {
  private readonly sender = randomUUID();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly ready: Promise<void>;

  public constructor(
    url: string,
    private readonly channel: string,
    private readonly receive: (event: unknown) => Promise<void>,
    private readonly onError: () => void
  ) {
    const options = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000
    };
    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, options);
    this.publisher.on("error", onError);
    this.subscriber.on("error", onError);
    this.subscriber.on("message", (channelName, message) => {
      if (channelName !== this.channel) return;
      try {
        const parsed = envelopeSchema.safeParse(JSON.parse(message));
        if (!parsed.success || parsed.data.sender === this.sender) return;
        void this.receive(parsed.data.event).catch(this.onError);
      } catch {
        this.onError();
      }
    });
    this.subscriber.on("ready", () => {
      void this.subscriber.subscribe(this.channel).catch(this.onError);
    });
    this.ready = this.connect();
    void this.ready.catch(onError);
  }

  private async connect(): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(this.channel);
  }

  public async publish(event: unknown): Promise<void> {
    await this.ready.catch(() => undefined);
    if (this.publisher.status !== "ready") {
      throw new Error("Shared live updates are temporarily unavailable");
    }
    const envelope = envelopeSchema.parse({ sender: this.sender, event });
    await this.publisher.publish(this.channel, JSON.stringify(envelope));
  }

  public async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  public close(): void {
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
