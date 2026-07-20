# pi-vision-bridge

Pi extension for OCR on images and PDFs using RapidOCR + pymupdf. Bridges the vision gap for AI mode.

## Features

- 🖼️ **Image OCR**: Extract text from PNG, JPG, JPEG, GIF, BMP, WebP, TIFF
- 📄 **PDF OCR**: Extract text from PDF files (all pages or specific pages)
- 🌐 **URL Support**: Download and OCR images directly from URLs
- 📊 **Structured Output**: Get text with confidence scores and bounding boxes
- ⚡ **Fast Processing**: Powered by RapidOCR (ONNX, CPU-optimized)

## Installation

```bash
npm install
```

The extension will automatically install Python dependencies on first run.

## Usage

This extension provides the `vision-ocr` tool for Pi AI:

```typescript
// Extract text from image
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/image.png"
});

// Extract text from PDF
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/document.pdf",
  pages: "1-3"
});

// Extract from URL
const result = await pi.tools["vision-ocr"].execute({
  path: "https://example.com/image.jpg"
});

// Get detailed output with bounding boxes
const result = await pi.tools["vision-ocr"].execute({
  path: "/path/to/image.png",
  detail: true
});
```

## API

### `vision-ocr` Tool

#### Parameters

- `path` (required): Path to image/PDF file or URL
- `pages` (optional): PDF page selection (e.g., "1", "1-3", "1,3,5", "all")
- `detail` (optional): Return per-region details with bounding boxes (default: false)
- `preprocess` (optional): Image preprocessing ("none", "grayscale", "high_contrast", "upscale")

#### Returns

Returns extracted text as plain string, or structured JSON with bounding boxes if `detail: true`.

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Run all checks
npm run check
```

## Requirements

- Node.js 18+
- Python 3.8+ (for OCR backend)
- Pi AI environment

## License

MIT

## Keywords

pi, pi-extension, vision, ocr, rapidocr, pymupdf, image, pdf, text-extraction
