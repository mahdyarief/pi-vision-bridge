# pi-vision-bridge

> Pi extension for OCR on images and PDFs using RapidOCR + pymupdf.
> Bridges the vision gap for AI agents that cannot see images directly.

## Overview

`pi-vision-bridge` is a [Pi](https://github.com/anthropics/pi) extension that provides local OCR (Optical Character Recognition) capabilities. It extracts text from images and PDF files using [RapidOCR](https://github.com/RapidAI/RapidOCR) (ONNX-based, CPU-optimized) and [PyMuPDF](https://pymupdf.readthedocs.io/) for PDF rendering.

**No API keys. No cloud services. Everything runs locally.**

## Features

- 🖼️ **Image OCR** — PNG, JPG, JPEG, GIF, BMP, WebP, TIFF
- 📄 **PDF OCR** — All pages or specific page selection
- 🌐 **URL Support** — Download and OCR images from URLs (including Imgur auto-normalization)
- 📊 **Structured Output** — Text with confidence scores and bounding box coordinates
- 🎨 **Image Preprocessing** — Grayscale, high contrast, upscale for better accuracy
- ⚡ **Auto-dependency** — Python deps auto-installed on first run
- 🔒 **Offline-first** — Local files work without internet

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Pi AI Agent                        │
│                                                      │
│   tool call: vision-ocr({ path, detail, ... })       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              src/extension.ts                        │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌────────────────┐   │
│  │  Input    │──▶│  Router  │──▶│  OCR Engine    │   │
│  │  Parser   │   │          │   │  (Python)      │   │
│  └──────────┘   └──────────┘   └────────────────┘   │
│       │              │                   │           │
│       ▼              ▼                   ▼           │
│  ┌──────────┐   ┌──────────┐   ┌────────────────┐   │
│  │  URL?    │   │  Image?  │   │  RapidOCR      │   │
│  │  →download│   │  PDF?  │   │  + Pillow      │   │
│  │  → temp  │   │  → route │   │  + pymupdf     │   │
│  └──────────┘   └──────────┘   └────────────────┘   │
│                                    │                 │
│                                    ▼                 │
│                           ┌────────────────┐         │
│                           │  Formatter     │         │
│                           │  → text result │         │
│                           └────────────────┘         │
└─────────────────────────────────────────────────────┘
```

---

## Execution Flow

```
Input (path/url)
    │
    ├─ Is URL? ──────────────────────────────────┐
    │    ├─ Imgur URL? → normalize to i.imgur.com │
    │    └─ Download to temp file (.tmp)          │
    │                                             │
    ├─ Is Image? ──────────────────────────────┐  │
    │    └─ runOcrOnImage(path, preprocess)    │  │
    │         ├─ Open with Pillow              │  │
    │         ├─ Apply preprocessing           │  │
    │         ├─ Run RapidOCR                  │  │
    │         └─ Return { texts, elapsed }     │  │
    │                                          │  │
    ├─ Is PDF? ────────────────────────────┐   │  │
    │    └─ runOcrOnPdf(path, pages, pre)  │   │  │
    │         ├─ Open with PyMuPDF         │   │  │
    │         ├─ For each page:            │   │  │
    │         │    ├─ Render to pixmap     │   │  │
    │         │    ├─ Convert to PIL Image │   │  │
    │         │    ├─ Apply preprocessing  │   │  │
    │         │    └─ Run RapidOCR         │   │  │
    │         └─ Return { pages, total }   │   │  │
    │                                      │   │  │
    └─ Unsupported format → error          │   │  │
                                           │   │  │
    Format Result ◄────────────────────────┘   │  │
    ├─ detail=true  → text + conf% + bbox      │  │
    └─ detail=false → sorted text block         │  │
                                                │  │
    Cleanup temp file (if URL) ◄────────────────┘  │
                                                   │
    Return ToolExecutionResult ◄───────────────────┘
```

---

## Method Reference

### Entry Point

| Function | Description |
|----------|-------------|
| `createExtension()` | Factory function that returns the Pi extension. Registers the `vision-ocr` tool and `/vision-ocr` slash command. |

### Input Validation

| Function | Signature | Description |
|----------|-----------|-------------|
| `isSupportedImage(path)` | `(string) → boolean` | Checks if path ends with a supported image extension |
| `isPdf(path)` | `(string) → boolean` | Checks if path ends with `.pdf` |
| `isUrl(input)` | `(string) → boolean` | Checks if input starts with `http://` or `https://` |
| `isSupportedPath(path)` | `(string) → boolean` | Combines `isSupportedImage` + `isPdf` |
| `fileExists(path)` | `(string) → Promise<boolean>` | Async check via `fs.access` |
| `resolvePath(imagePath, cwd)` | `(string, string) → string` | Resolves relative paths against `cwd`, passes through absolute paths |

### URL Handling

| Function | Signature | Description |
|----------|-----------|-------------|
| `normalizeImageUrl(url)` | `(string) → string` | Converts `imgur.com/ID` → `i.imgur.com/ID.png`. Passes through other URLs unchanged. |
| `downloadToTemp(url)` | `(string) → Promise<string>` | Downloads URL to OS temp dir using Python `urllib`. Returns temp file path. |

### OCR Engine

| Function | Signature | Description |
|----------|-----------|-------------|
| `ensureDependencies()` | `() → Promise<void>` | Checks if Python deps are installed. If not, runs `pip install rapidocr_onnxruntime pymupdf Pillow numpy`. |
| `runOcrOnImage(imagePath, preprocess)` | `(string, string) → Promise<OcrResult>` | Spawns Python subprocess to run RapidOCR on a single image. Returns `{ texts: [{text, confidence, bbox}], elapsed: number[] }`. |
| `runOcrOnPdf(pdfPath, pages, preprocess)` | `(string, string, string) → Promise<PdfOcrResult>` | Spawns Python subprocess to render PDF pages via PyMuPDF, then OCR each page. Returns `{ pages: [{pageNumber, texts, elapsed}], totalPages }`. |

### Preprocessing Modes

Applied via Pillow before OCR:

| Mode | What it does |
|------|-------------|
| `none` | No preprocessing |
| `grayscale` | Convert to grayscale (`ImageOps.grayscale`) |
| `high_contrast` | Enhance contrast by 2x (`ImageEnhance.Contrast`) |
| `upscale` | Resize to 2x with `LANCZOS` resampling |

### Formatters

| Function | Signature | Description |
|----------|-----------|-------------|
| `formatImageResult(result, filePath, detail)` | `(OcrResult, string, boolean) → string` | Formats image OCR output. Detail mode: text + confidence% + bbox coords. Normal mode: sorted text block in code fence. |
| `formatPdfResult(result, filePath, detail)` | `(PdfOcrResult, string, boolean) → string` | Formats PDF OCR output. Per-page sections with text region count and processing time. |

### Helpers

| Function | Signature | Description |
|----------|-----------|-------------|
| `textResult(text, details)` | `(string, object) → ToolExecutionResult` | Wraps text into the Pi tool result format `{ content: [{ type: "text", text }] }` |

---

## Installation

```bash
npm install
```

Python dependencies are auto-installed on first OCR call:
- `rapidocr_onnxruntime` — OCR engine (ONNX, CPU)
- `pymupdf` — PDF rendering
- `Pillow` — Image processing
- `numpy` — Array operations

**Requirements:**
- Node.js 18+
- Python 3.8+ (must be available as `python` in PATH)

---

## Usage

### As Pi Tool

The extension registers a `vision-ocr` tool that Pi AI can call:

```typescript
// Basic image OCR
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/image.png"
});

// PDF with page selection
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/document.pdf",
  pages: "1-3"          // or "1,3,5" or "all"
});

// From URL (auto-downloads to temp)
const result = await pi.tools["vision-ocr"].execute({
  path: "https://example.com/screenshot.png"
});

// Imgur URL (auto-normalized)
const result = await pi.tools["vision-ocr"].execute({
  path: "https://imgur.com/ABC123"
});

// With preprocessing for better accuracy
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/low-res.jpg",
  preprocess: "upscale"  // or "grayscale", "high_contrast"
});

// Detailed output with confidence scores and bounding boxes
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/image.png",
  detail: true
});
```

### As Slash Command

```
/vision-ocr /path/to/image.png
/vision-ocr /path/to/doc.pdf --pages=1-3
/vision-ocr https://imgur.com/ABC123 --detail --grayscale
```

### Tool Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | ✅ | — | File path or URL |
| `detail` | boolean | — | `false` | Include confidence scores + bounding boxes |
| `preprocess` | string | — | `"none"` | `"none"` / `"grayscale"` / `"high_contrast"` / `"upscale"` |
| `pages` | string | — | `"all"` | PDF page selection: `"1"`, `"1-3"`, `"1,3,5"`, `"all"` |

### Output Format

**Normal mode** (`detail: false`):
```
## OCR Result: /path/to/image.png

Detected **5** text region(s).
Processing time: 0.42s

```
Hello World
This is extracted text
Line by line
```
```

**Detail mode** (`detail: true`):
```
## OCR Result: /path/to/image.png

Detected **5** text region(s).
Processing time: 0.42s

- `Hello World` (conf: 99.2%, pos: x=10-200 y=5-30)
- `This is extracted text` (conf: 97.8%, pos: x=10-350 y=35-60)
- `Line by line` (conf: 95.1%, pos: x=10-180 y=65-90)
```

---

## File Structure

```
pi-vision-bridge/
├── index.ts              # Re-exports from src/extension.ts + types
├── index.test.ts         # 9 tests (unit + integration with real OCR)
├── src/
│   ├── extension.ts      # Core logic (530 lines)
│   └── types.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
├── biome.json            # Linter/formatter config
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

---

## Development

```bash
# Run all checks (test + typecheck + lint)
npm run check

# Run tests only (9 tests, ~30s with real OCR)
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Auto-fix lint issues
npx biome check --fix --unsafe .

# Format
npm run format
```

---

## License

MIT
