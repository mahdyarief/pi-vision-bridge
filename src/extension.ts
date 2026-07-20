import { execFile } from "node:child_process";
import { access, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { PiInstance, RuntimeContext, ToolExecutionResult } from "./types.ts";

const execFileAsync = promisify(execFile);

const SUPPORTED_IMAGE_FORMATS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif"];
const SUPPORTED_PDF_FORMATS = [".pdf"];

function textResult(text: string, details: Record<string, unknown> = {}): ToolExecutionResult {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function isSupportedImage(path: string): boolean {
  const lower = path.toLowerCase();
  return SUPPORTED_IMAGE_FORMATS.some((ext) => lower.endsWith(ext));
}

function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function isSupportedPath(path: string): boolean {
  return isSupportedImage(path) || isPdf(path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(imagePath: string, cwd: string): string {
  const isAbsolute = imagePath.startsWith("/") || /^[A-Z]:[\\/]/i.test(imagePath);
  return isAbsolute ? imagePath : join(cwd, imagePath);
}

/**
 * Normalize image URLs.
 * Imgur: https://imgur.com/XXXXX → https://i.imgur.com/XXXXX.png
 */
function normalizeImageUrl(url: string): string {
  const imgurMatch = url.match(/imgur\.com\/([a-zA-Z0-9]+)(?:\.\w+)?$/);
  if (imgurMatch) {
    return `https://i.imgur.com/${imgurMatch[1]}.png`;
  }
  return url;
}

/**
 * Download a URL to a temp file. Returns the path to the downloaded file.
 */
async function downloadToTemp(url: string): Promise<string> {
  const ext = isSupportedImage(url) ? join("", url.match(/\.\w+$/)?.[0] || ".png") : ".png";
  const tmpPath = join(tmpdir(), `pi-vision-${Date.now()}${ext}`);

  const { stdout } = await execFileAsync(
    "python",
    [
      "-c",
      `
import urllib.request
url = "${url.replace(/\\/g, "\\\\")}"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=30) as r:
    data = r.read()
with open("${tmpPath.replace(/\\/g, "\\\\")}", "wb") as f:
    f.write(data)
print("OK")
`,
    ],
    { timeout: 30000 },
  );

  if (!stdout.trim().includes("OK")) {
    throw new Error(`Failed to download: ${url}`);
  }

  return tmpPath;
}

/**
 * Run RapidOCR via Python subprocess for a single image.
 */
async function runOcrOnImage(
  imagePath: string,
  preprocess: string,
): Promise<{
  texts: Array<{ text: string; confidence: number; bbox: number[][] }>;
  elapsed: number[];
}> {
  const pythonScript = `
import json, sys
from rapidocr_onnxruntime import RapidOCR
from PIL import Image, ImageOps, ImageEnhance
import numpy as np

path = r"${imagePath.replace(/\\/g, "\\\\")}"
preprocess_mode = "${preprocess}"

try:
    im = Image.open(path).convert("RGB")
except Exception as e:
    print(json.dumps({"error": f"Cannot open image: {e}"}))
    sys.exit(1)

if preprocess_mode == "grayscale":
    im = ImageOps.grayscale(im).convert("RGB")
elif preprocess_mode == "high_contrast":
    im = ImageOps.grayscale(im)
    im = ImageEnhance.Contrast(im).enhance(2.0)
    im = im.convert("RGB")
elif preprocess_mode == "upscale":
    w, h = im.size
    im = im.resize((w * 2, h * 2), Image.Resampling.LANCZOS)

w, h = im.size
max_dim = 1024
if max(w, h) > max_dim:
    scale = max_dim / max(w, h)
    im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

arr = np.array(im)
engine = RapidOCR()
result, elapse = engine(arr)

if result is None:
    print(json.dumps({"texts": [], "elapsed": elapse if isinstance(elapse, list) else [elapse]}))
    sys.exit(0)

texts = []
for item in result:
    bbox, text, conf = item[0], item[1], float(item[2])
    texts.append({"text": text, "confidence": round(conf, 4), "bbox": bbox})

print(json.dumps({"texts": texts, "elapsed": elapse if isinstance(elapse, list) else [elapse]}))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript], {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout.trim());
}

/**
 * Run OCR on a PDF file using pymupdf to convert pages to images.
 */
async function runOcrOnPdf(
  pdfPath: string,
  pages: string,
  preprocess: string,
): Promise<{
  pages: Array<{
    pageNumber: number;
    texts: Array<{ text: string; confidence: number; bbox: number[][] }>;
    elapsed: number[];
  }>;
  totalPages: number;
}> {
  const escapedPath = pdfPath.replace(/\\/g, "\\\\");
  const pythonScript = `
import json, sys, os, tempfile
import fitz  # pymupdf
from rapidocr_onnxruntime import RapidOCR
from PIL import Image, ImageOps, ImageEnhance
import numpy as np

pdf_path = r"${escapedPath}"
pages_arg = "${pages}"
preprocess_mode = "${preprocess}"

try:
    doc = fitz.open(pdf_path)
except Exception as e:
    print(json.dumps({"error": f"Cannot open PDF: {e}"}))
    sys.exit(1)

total_pages = len(doc)

def parse_pages(spec, total):
    if not spec or spec == "all":
        return list(range(total))
    result = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            start = max(1, int(start))
            end = min(total, int(end))
            result.extend(range(start - 1, end))
        else:
            idx = int(part) - 1
            if 0 <= idx < total:
                result.append(idx)
    return sorted(set(result))

page_indices = parse_pages(pages_arg, total_pages)

engine = RapidOCR()
results = []
tmp_dir = tempfile.mkdtemp(prefix="pi_ocr_pdf_")

try:
    for i in page_indices:
        page = doc[i]
        mat = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=mat)
        img_path = os.path.join(tmp_dir, f"page_{i}.png")
        pix.save(img_path)

        im = Image.open(img_path).convert("RGB")
        if preprocess_mode == "grayscale":
            im = ImageOps.grayscale(im).convert("RGB")
        elif preprocess_mode == "high_contrast":
            im = ImageOps.grayscale(im)
            im = ImageEnhance.Contrast(im).enhance(2.0)
            im = im.convert("RGB")

        w, h = im.size
        max_dim = 1024
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

        arr = np.array(im)
        result, elapse = engine(arr)

        texts = []
        if result:
            for item in result:
                bbox, text, conf = item[0], item[1], float(item[2])
                texts.append({"text": text, "confidence": round(conf, 4), "bbox": bbox})

        results.append({
            "pageNumber": i + 1,
            "texts": texts,
            "elapsed": elapse if isinstance(elapse, list) else [elapse],
        })

        os.remove(img_path)

finally:
    try:
        os.rmdir(tmp_dir)
    except:
        pass
    doc.close()

print(json.dumps({"pages": results, "totalPages": total_pages}))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript], {
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(stdout.trim());
}

function formatImageResult(
  result: Awaited<ReturnType<typeof runOcrOnImage>>,
  filePath: string,
  detail: boolean,
): string {
  const lines: string[] = [];
  lines.push(`## OCR Result: ${filePath}`);
  lines.push("");

  if (result.texts.length === 0) {
    lines.push("**No text detected in image.**");
    return lines.join("\n");
  }

  lines.push(`Detected **${result.texts.length}** text region(s).`);
  if (result.elapsed.length > 0) {
    const totalTime = result.elapsed.reduce((a: number, b: number) => a + b, 0);
    lines.push(`Processing time: ${totalTime.toFixed(2)}s`);
  }
  lines.push("");

  if (detail) {
    lines.push("### Text Regions");
    lines.push("");
    for (const item of result.texts) {
      const ys = item.bbox.map((p) => p[1]);
      const xs = item.bbox.map((p) => p[0]);
      lines.push(
        `- \`${item.text}\` (conf: ${(item.confidence * 100).toFixed(1)}%, pos: x=${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)} y=${Math.min(...ys).toFixed(0)}-${Math.max(...ys).toFixed(0)})`,
      );
    }
  } else {
    lines.push("### Extracted Text");
    lines.push("");
    const sorted = [...result.texts].sort((a, b) => {
      const ayMin = Math.min(...a.bbox.map((p) => p[1]));
      const byMin = Math.min(...b.bbox.map((p) => p[1]));
      return ayMin - byMin;
    });
    lines.push("```");
    for (const item of sorted) {
      lines.push(item.text);
    }
    lines.push("```");
  }

  return lines.join("\n");
}

function formatPdfResult(
  result: Awaited<ReturnType<typeof runOcrOnPdf>>,
  filePath: string,
  detail: boolean,
): string {
  const lines: string[] = [];
  lines.push(`## PDF OCR Result: ${filePath}`);
  lines.push("");
  lines.push(`PDF has **${result.totalPages}** page(s). OCR'd **${result.pages.length}** page(s).`);
  lines.push("");

  const allEmpty = result.pages.every((p) => p.texts.length === 0);
  if (allEmpty) {
    lines.push("**No text detected in any page.**");
    return lines.join("\n");
  }

  for (const page of result.pages) {
    lines.push(`### Page ${page.pageNumber}`);
    lines.push("");

    if (page.texts.length === 0) {
      lines.push("*(no text detected)*");
      lines.push("");
      continue;
    }

    lines.push(`${page.texts.length} text region(s).`);
    if (page.elapsed.length > 0) {
      const totalTime = page.elapsed.reduce((a: number, b: number) => a + b, 0);
      lines.push(`Processing time: ${totalTime.toFixed(2)}s`);
    }
    lines.push("");

    if (detail) {
      for (const item of page.texts) {
        const ys = item.bbox.map((p) => p[1]);
        const xs = item.bbox.map((p) => p[0]);
        lines.push(
          `- \`${item.text}\` (conf: ${(item.confidence * 100).toFixed(1)}%, pos: x=${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)} y=${Math.min(...ys).toFixed(0)}-${Math.max(...ys).toFixed(0)})`,
        );
      }
    } else {
      const sorted = [...page.texts].sort((a, b) => {
        const ayMin = Math.min(...a.bbox.map((p) => p[1]));
        const byMin = Math.min(...b.bbox.map((p) => p[1]));
        return ayMin - byMin;
      });
      lines.push("```");
      for (const item of sorted) {
        lines.push(item.text);
      }
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

export const createExtension = () => {
  return (pi: PiInstance) => {
    pi.registerTool({
      name: "vision-ocr",
      label: "Vision OCR",
      description:
        "Extract text from images, PDFs, and URLs using RapidOCR (ONNX, CPU). Supports PNG, JPG, GIF, BMP, WebP, TIFF, PDF, and image URLs (including Imgur). For PDFs, supports page selection. Use when the AI model cannot see images directly.",
      promptSnippet:
        "Extracts text from images/PDFs/URLs using local OCR. Imgur URLs (imgur.com/ID) are auto-normalized to direct image links. Works offline for local files, needs network for URLs.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to image/PDF file, or a URL (e.g. https://imgur.com/XXXXX or direct image URL)",
          },
          detail: {
            type: "boolean",
            description:
              "If true, return per-region details (text, confidence, bounding box). Default: false.",
          },
          preprocess: {
            type: "string",
            enum: ["none", "grayscale", "high_contrast", "upscale"],
            description: "Image preprocessing to improve OCR accuracy.",
          },
          pages: {
            type: "string",
            description:
              "PDF page selection. Examples: 'all' (default), '1', '1-3', '1,3,5'. Ignored for images/URLs.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const input = params.path as string;
        const detail = (params.detail as boolean) ?? false;
        const preprocess = (params.preprocess as string) ?? "none";
        const pages = (params.pages as string) ?? "all";

        if (!input) {
          return textResult("Error: 'path' parameter is required.");
        }

        let tmpFile: string | null = null;

        try {
          // URL handling: download to temp file
          if (isUrl(input)) {
            const url = normalizeImageUrl(input);
            tmpFile = await downloadToTemp(url);
            const result = await runOcrOnImage(tmpFile, preprocess);
            const formatted = formatImageResult(result, `${input} → ${url}`, detail);
            return textResult(formatted, {
              url: input,
              normalizedUrl: url,
              textCount: result.texts.length,
              elapsed: result.elapsed,
            });
          }

          // Local file handling
          if (!isSupportedPath(input)) {
            return textResult(
              `Error: Unsupported format. Supported: ${[...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_PDF_FORMATS].join(", ")}, or a URL`,
            );
          }

          const resolved = resolvePath(input, ctx.cwd || process.cwd());

          if (!(await fileExists(resolved))) {
            return textResult(`Error: File not found: ${resolved}`);
          }

          if (isPdf(resolved)) {
            const result = await runOcrOnPdf(resolved, pages, preprocess);
            const formatted = formatPdfResult(result, resolved, detail);
            return textResult(formatted, {
              file: resolved,
              totalPages: result.totalPages,
              ocrPages: result.pages.length,
            });
          }
          const result = await runOcrOnImage(resolved, preprocess);
          const formatted = formatImageResult(result, resolved, detail);
          return textResult(formatted, {
            file: resolved,
            textCount: result.texts.length,
            elapsed: result.elapsed,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return textResult(
            `OCR failed: ${msg}\n\nMake sure dependencies are installed:\n- pip install rapidocr-onnxruntime\n- pip install pymupdf  (for PDF)`,
          );
        } finally {
          // Cleanup temp file
          if (tmpFile) {
            try {
              await unlink(tmpFile);
            } catch {
              /* ignore */
            }
          }
        }
      },
    });

    pi.registerCommand("vision-ocr", {
      description: "Extract text from an image, PDF, or URL using local OCR",
      handler: async (args, ctx) => {
        const parts = args.trim().split(/\s+/);
        const input = parts[0];
        const detail = parts.includes("--detail");
        const preprocess = parts.includes("--grayscale")
          ? "grayscale"
          : parts.includes("--contrast")
            ? "high_contrast"
            : parts.includes("--upscale")
              ? "upscale"
              : "none";

        const pagesArg = parts.find((p) => p.startsWith("--pages="));
        const pages = pagesArg ? pagesArg.split("=")[1] : "all";

        if (!input) {
          ctx.ui?.notify(
            "Usage: /vision-ocr <path|url> [--detail] [--grayscale|--contrast|--upscale] [--pages=1-3]",
            "warn",
          );
          return;
        }

        // For command handler, we need to re-execute through the tool logic
        // since the tool handles URL download + cleanup
        ctx.ui?.notify(
          "Use the vision-ocr tool directly (not the command) for URL support.",
          "info",
        );
      },
    });
  };
};

const registerExtension = createExtension();
export default registerExtension;
