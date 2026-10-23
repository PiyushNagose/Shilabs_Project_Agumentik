import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractLeadDocumentLink, extractLeadDocumentUpload } from "./lead-document-upload.js";
import { extractPdfPages, extractPdfWithOcr } from "./lead-document-ocr.js";

const mocks = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock("node:worker_threads", () => ({ Worker: mocks.worker }));

function pdfReader(texts: string[]) {
  return {
    getInfo: vi.fn().mockImplementation((options?: { partial?: number[] }) => Promise.resolve({
      total: texts.length,
      pages: options?.partial?.map((pageNumber) => ({ pageNumber, width: 612, height: 792 })) ?? []
    })),
    getText: vi.fn().mockResolvedValue({
      total: texts.length,
      text: texts.map((text, index) => `${text}\n-- ${String(index + 1)} of ${String(texts.length)} --`).join("\n"),
      pages: texts.map((text, index) => ({ num: index + 1, text }))
    }),
    getScreenshot: vi.fn().mockImplementation((options: { partial: number[] }) => Promise.resolve({
      pages: [{ pageNumber: options.partial[0], data: new Uint8Array([1, 2, 3]) }]
    }))
  };
}

describe("PDF page extraction", () => {
  it("uses actual page text without synthetic page markers or OCR for native PDFs", async () => {
    const parser = pdfReader(["Native first page", "Native second page"]);
    const recognize = vi.fn();
    await expect(extractPdfPages(parser, recognize)).resolves.toBe("Native first page\n\nNative second page");
    expect(recognize).not.toHaveBeenCalled();
    expect(parser.getScreenshot).not.toHaveBeenCalled();
  });

  it("requests OCR for marker-only extraction and preserves mixed page order", async () => {
    const parser = pdfReader(["Native first", " \n", "Native third", ""]);
    const recognize = vi.fn().mockResolvedValueOnce("Scanned second").mockResolvedValueOnce("Scanned fourth");
    await expect(extractPdfPages(parser, recognize)).resolves.toBe(
      "Native first\n\nScanned second\n\nNative third\n\nScanned fourth"
    );
    expect(parser.getScreenshot.mock.calls.map(([options]) => (options as { partial: number[] }).partial)).toEqual([[2], [4]]);
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when OCR yields no readable text, without indexing page markers", async () => {
    await expect(extractPdfPages(pdfReader([""]), vi.fn().mockResolvedValue(" \n")))
      .rejects.toThrow("No readable text was found after OCR");
  });

  it("rejects oversized page counts before text extraction or OCR", async () => {
    const parser = pdfReader(Array<string>(101).fill("native"));
    await expect(extractPdfPages(parser, vi.fn())).rejects.toThrow("100 pages");
    expect(parser.getText).not.toHaveBeenCalled();
  });

  it("rejects too many scanned pages before rendering", async () => {
    const parser = pdfReader(Array<string>(13).fill(""));
    await expect(extractPdfPages(parser, vi.fn())).rejects.toThrow("more than 12 pages");
    expect(parser.getScreenshot).not.toHaveBeenCalled();
  });

  it("bounds both dimensions and pixels before rendering extreme aspect ratios", async () => {
    const parser = pdfReader([""]);
    parser.getInfo.mockResolvedValue({ total: 1, pages: [{ pageNumber: 1, width: 100, height: 100_000 }] });
    await extractPdfPages(parser, vi.fn().mockResolvedValue("Readable scan"));
    const scale = (parser.getScreenshot.mock.calls[0]?.[0] as { scale: number }).scale;
    expect(100_000 * scale).toBeLessThanOrEqual(2500);
    expect(Math.ceil(100 * scale) * Math.ceil(100_000 * scale)).toBeLessThanOrEqual(4_000_000);
  });

  it("rejects invalid geometry before allocating a screenshot", async () => {
    const parser = pdfReader([""]);
    parser.getInfo.mockResolvedValue({ total: 1, pages: [{ pageNumber: 1, width: Infinity, height: 792 }] });
    await expect(extractPdfPages(parser, vi.fn())).rejects.toThrow("invalid dimensions");
    expect(parser.getScreenshot).not.toHaveBeenCalled();
  });

  it("stops before rendering pages beyond the aggregate pixel budget", async () => {
    const parser = pdfReader(Array<string>(9).fill(""));
    parser.getInfo.mockResolvedValue({ total: 9, pages: Array.from({ length: 9 }, (_, index) => ({
      pageNumber: index + 1, width: 1000, height: 1000
    })) });
    await expect(extractPdfPages(parser, vi.fn().mockResolvedValue("Scan text")))
      .rejects.toThrow("pixel budget");
    expect(parser.getScreenshot).toHaveBeenCalledTimes(8);
  });

  it("enforces the text limit on OCR output too", async () => {
    await expect(extractPdfPages(pdfReader([""]), vi.fn().mockResolvedValue("a".repeat(250_001))))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it("rejects excessive native text before OCR", async () => {
    const parser = pdfReader(["a".repeat(250_001), ""]);
    await expect(extractPdfPages(parser, vi.fn())).rejects.toMatchObject({ statusCode: 413 });
    expect(parser.getScreenshot).not.toHaveBeenCalled();
  });

  it("retains a long paragraph without clipping", async () => {
    const text = "Full paragraph text. ".repeat(300);
    await expect(extractPdfPages(pdfReader([text]), vi.fn())).resolves.toBe(text);
  });
});

describe("local OCR worker lifecycle", () => {
  let worker: EventEmitter & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.stubEnv("OCR_TIMEOUT_MS", "1000");
    vi.stubEnv("OCR_LANGUAGE", "eng");
    vi.stubEnv("OCR_LANG_PATH", "C:/local/ocr-data");
    vi.stubEnv("OCR_LANG_GZIP", "false");
    worker = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(() => queueMicrotask(() => worker.emit("message", { text: "Actual OCR response" }))),
      terminate: vi.fn(() => { worker.emit("exit", 1); return Promise.resolve(1); })
    });
    mocks.worker.mockImplementation(function () {
      queueMicrotask(() => worker.emit("message", { ready: true }));
      return worker;
    });
  });

  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("passes explicit language configuration and terminates after success", async () => {
    await expect(extractPdfWithOcr(pdfReader([""]))).resolves.toBe("Actual OCR response");
    expect(mocks.worker).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      workerData: expect.objectContaining({ language: "eng", langPath: "C:/local/ocr-data", gzip: false }) as unknown
    }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the supervisor when language initialization never returns", async () => {
    vi.stubEnv("OCR_TIMEOUT_MS", "20");
    mocks.worker.mockImplementation(function () { return worker; });
    await expect(extractPdfWithOcr(pdfReader([""]))).rejects.toThrow("timed out");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates recognition at the deadline without returning partial text", async () => {
    vi.stubEnv("OCR_TIMEOUT_MS", "20");
    worker.postMessage.mockImplementation(() => undefined);
    await expect(extractPdfWithOcr(pdfReader(["Native page", ""]))).rejects.toThrow("timed out");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("returns an actionable Needs Attention error for missing or offline language assets", async () => {
    mocks.worker.mockImplementation(function () {
      queueMicrotask(() => worker.emit("message", { error: true }));
      return worker;
    });
    await expect(extractPdfWithOcr(pdfReader([""]))).rejects.toThrow("Needs Attention: Local OCR failed");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

describe("document upload validation", () => {
  it("rejects a forged PDF before parsing", async () => {
    await expect(extractLeadDocumentUpload({ originalname: "scan.pdf", mimetype: "application/pdf", buffer: Buffer.from("not PDF") } as Express.Multer.File))
      .rejects.toThrow("not a valid PDF");
  });

  it("sanitizes controls and preserves long text", async () => {
    const paragraph = "Long paragraph content. ".repeat(300);
    const result = await extractLeadDocumentUpload({ originalname: "notes.txt", mimetype: "text/plain", buffer: Buffer.from(`\u0001${paragraph}\r\nEnd`) } as Express.Multer.File);
    expect(result.content).toBe(`${paragraph.trimEnd()}\nEnd`);
  });
});

it.skipIf(process.env.OCR_SMOKE_TEST !== "true")("recognizes a generated raster-only PDF using the installed engine", async () => {
  const { Worker: ActualWorker } = await vi.importActual<typeof import("node:worker_threads")>("node:worker_threads");
  mocks.worker.mockImplementation(function (...args: ConstructorParameters<typeof ActualWorker>) {
    return new ActualWorker(...args);
  });
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(1200, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1200, 500);
  context.fillStyle = "black";
  context.font = "48px Arial";
  context.fillText("SHILABS SCANNED DOCUMENT", 60, 130);
  context.fillText("Order reference ALPHA 12345", 60, 230);
  const jpeg = canvas.toBuffer("image/jpeg");
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  const object = (id: number, data: string | Buffer) => {
    offsets[id] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(Buffer.from(`${String(id)} 0 obj\n`), Buffer.from(data), Buffer.from("\nendobj\n"));
  };
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 250] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
  object(4, Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(jpeg.length)} >>\nstream\n`),
    jpeg, Buffer.from("\nendstream")
  ]));
  const stream = "q 600 0 0 250 0 0 cm /Im0 Do Q";
  object(5, `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`));
  try {
    const result = await extractLeadDocumentUpload({
      originalname: "generated-scan.pdf", mimetype: "application/pdf", buffer: Buffer.concat(parts)
    } as Express.Multer.File);
    expect(result.content).toContain("ALPHA 12345");
    expect(result.content).toContain("SHILABS SCANNED DOCUMENT");
    expect(result.content).not.toContain("-- 1 of 1 --");
  } finally {
    mocks.worker.mockReset();
  }
}, 60_000);

describe("linked document safety", () => {
  it.each([
    "http://documents.example.com/brief.txt",
    "https://localhost/brief.txt",
    "https://127.0.0.1/brief.txt",
    "https://[::1]/brief.txt",
    "https://intranet.internal/brief.txt",
    "https://user:password@documents.example.com/brief.txt",
    "https://documents.example.com:8443/brief.txt",
    "not a document URL"
  ])("rejects an unsafe document URL: %s", async (url) => {
    await expect(extractLeadDocumentLink(url)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
