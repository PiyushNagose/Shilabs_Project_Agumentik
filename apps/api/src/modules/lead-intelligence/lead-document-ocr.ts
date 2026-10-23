import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { PDFParse } from "pdf-parse";
import { AppError } from "../../shared/errors.js";

const require = createRequire(import.meta.url);
const MAX_PDF_PAGES = 100;
const MAX_OCR_PAGES = 12;
const MAX_PAGE_PIXELS = 4_000_000;
const MAX_TOTAL_PIXELS = 32_000_000;
const MAX_DIMENSION = 2_500;
const MAX_TEXT_CHARACTERS = 250_000;
let activeDocuments = 0;

function attention(message: string): AppError {
  return new AppError(422, "VALIDATION_ERROR", `Needs Attention: ${message}`);
}

// The supervisor owns Tesseract's nested worker even while createWorker is loading
// language data. Terminating it also stops that worker before initialization returns.
const OCR_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { createWorker } = require(workerData.modulePath);
const fail = () => parentPort.postMessage({ error: true });
(async () => {
  const worker = await createWorker(workerData.language, 1, {
    langPath: workerData.langPath,
    gzip: workerData.gzip,
    cacheMethod: 'none',
    errorHandler: fail
  });
  parentPort.on('message', async (image) => {
    try {
      const result = await worker.recognize(Buffer.from(image), {}, { text: true });
      parentPort.postMessage({ text: result.data.text });
    } catch { fail(); }
  });
  parentPort.postMessage({ ready: true });
})().catch(fail);
`;

type PdfReader = Pick<PDFParse, "getInfo" | "getText" | "getScreenshot">;

export async function extractPdfPages(
  parser: PdfReader,
  recognize: (image: Uint8Array) => Promise<string>,
  checkActive: () => void = () => undefined
): Promise<string> {
  const info = await parser.getInfo();
  checkActive();
  if (!Number.isInteger(info.total) || info.total < 1 || info.total > MAX_PDF_PAGES) {
    throw attention(`PDFs must contain 1 to ${String(MAX_PDF_PAGES)} pages. Split this document before uploading.`);
  }
  const result = await parser.getText({ pageJoiner: "" });
  checkActive();
  // result.text includes generated page markers; only actual page text counts.
  const pages = Array.from({ length: info.total }, (_, index) => {
    const text = result.pages.find((page) => page.num === index + 1)?.text ?? "";
    return /[\p{L}\p{N}]/u.test(text) ? text : "";
  });
  const scanCount = pages.filter((text) => !text).length;
  if (scanCount > MAX_OCR_PAGES) {
    throw attention(`This PDF needs OCR on more than ${String(MAX_OCR_PAGES)} pages. Split it into smaller documents.`);
  }
  let pixels = 0;
  let characters = pages.reduce((sum, text) => sum + text.length + 2, 0);
  const checkLength = () => {
    if (characters > MAX_TEXT_CHARACTERS) {
      throw new AppError(413, "VALIDATION_ERROR", "The extracted document text exceeds the 250,000 character limit");
    }
  };
  checkLength();
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index]) continue;
    checkActive();
    const pageNumber = index + 1;
    const geometry = await parser.getInfo({ partial: [pageNumber], parsePageInfo: true });
    checkActive();
    const page = geometry.pages.find((item) => item.pageNumber === pageNumber);
    if (!page || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) {
      throw attention(`PDF page ${String(pageNumber)} has invalid dimensions.`);
    }
    const scale = Math.min(2, MAX_DIMENSION / page.width, MAX_DIMENSION / page.height,
      Math.sqrt((MAX_PAGE_PIXELS - 2 * MAX_DIMENSION) / (page.width * page.height)));
    const pagePixels = Math.ceil(page.width * scale) * Math.ceil(page.height * scale);
    pixels += pagePixels;
    if (!Number.isFinite(pagePixels) || pagePixels > MAX_PAGE_PIXELS || pixels > MAX_TOTAL_PIXELS) {
      throw attention("The PDF exceeds the OCR pixel budget. Split it into smaller documents.");
    }
    const screenshot = await parser.getScreenshot({
      partial: [pageNumber], scale, imageBuffer: true, imageDataUrl: false
    });
    checkActive();
    const image = screenshot.pages.find((item) => item.pageNumber === pageNumber);
    if (!image?.data.length) throw attention(`PDF page ${String(pageNumber)} could not be rendered for OCR.`);
    const text = await recognize(image.data);
    checkActive();
    pages[index] = text;
    characters += text.length;
    checkLength();
  }
  const content = pages.join("\n\n");
  if (!/[\p{L}\p{N}]/u.test(content)) {
    throw attention("No readable text was found after OCR. Upload a clearer scan or a text document.");
  }
  return content;
}

export async function extractPdfWithOcr(parser: PdfReader): Promise<string> {
  if (activeDocuments >= 2) throw attention("Document extraction is busy. Retry shortly.");
  activeDocuments += 1;
  let worker: Worker | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failure = () => attention("Local OCR failed. Check OCR_LANGUAGE and OCR_LANG_PATH language assets; the default language download requires internet access. Retry with local traineddata if offline.");
  const configuredTimeout = Number(process.env.OCR_TIMEOUT_MS ?? 120_000);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout >= 1
    ? Math.min(configuredTimeout, 180_000) : 120_000;
  const checkActive = () => {
    if (expired) throw attention("PDF extraction timed out. Split the document and retry.");
  };
  const receive = (target: Worker): Promise<{ ready?: boolean; text?: string }> => new Promise((resolve, reject) => {
    const cleanup = () => {
      target.off("message", onMessage);
      target.off("error", onError);
      target.off("exit", onExit);
    };
    const onMessage = (message: { error?: boolean; ready?: boolean; text?: string }) => {
      cleanup();
      if (message.error) reject(failure());
      else resolve(message);
    };
    const onError = () => { cleanup(); reject(failure()); };
    const onExit = () => { cleanup(); reject(failure()); };
    target.once("message", onMessage);
    target.once("error", onError);
    target.once("exit", onExit);
  });
  const recognize = async (image: Uint8Array): Promise<string> => {
    checkActive();
    if (!worker) {
      const language = process.env.OCR_LANGUAGE ?? "eng";
      if (!/^[a-zA-Z0-9_]+(?:\+[a-zA-Z0-9_]+)*$/u.test(language)) throw failure();
      const configuredLangPath = process.env.OCR_LANG_PATH?.trim();
      worker = new Worker(OCR_WORKER_SOURCE, {
        eval: true,
        execArgv: [],
        workerData: {
          modulePath: require.resolve("tesseract.js"), language,
          langPath: configuredLangPath?.length ? configuredLangPath : "https://tessdata.projectnaptha.com/4.0.0",
          gzip: process.env.OCR_LANG_GZIP !== "false"
        }
      });
      worker.on("error", () => undefined);
      const ready = await receive(worker);
      checkActive();
      if (!ready.ready) throw failure();
    }
    const response = receive(worker);
    worker.postMessage(image);
    const result = await response;
    if (typeof result.text !== "string") throw failure();
    return result.text;
  };
  try {
    return await Promise.race([
      extractPdfPages(parser, recognize, checkActive),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(attention("PDF extraction timed out. Split the document and retry."));
        }, timeout);
      })
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
    try { if (worker) await worker.terminate(); }
    finally { activeDocuments -= 1; }
  }
}
