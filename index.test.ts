import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createExtension } from "./src/extension.ts";
import type { PiInstance, PiToolDefinition } from "./src/types.ts";

function createMockPi(): {
  instance: PiInstance;
  tools: Map<string, PiToolDefinition>;
} {
  const tools = new Map<string, PiToolDefinition>();
  return {
    instance: {
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: () => {},
    },
    tools,
  };
}

describe("pi-vision-bridge", () => {
  it("registers vision-ocr tool", () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    assert.ok(tools.has("vision-ocr"), "vision-ocr tool should be registered");
  });

  it("tool has correct parameter schema", () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    assert.ok(tool.parameters);
    const params = tool.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.path, "should have path parameter");
    assert.ok(params.properties.pages, "should have pages parameter for PDF");
    assert.ok(params.required.includes("path"), "path should be required");
  });

  it("rejects unsupported file formats", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const result = await tool.execute(
      "test-1",
      { path: "test.txt" },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    assert.match(result.content[0].text, /Unsupported format/);
  });

  it("rejects missing files", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const result = await tool.execute(
      "test-2",
      { path: "C:/nonexistent/fake.png" },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    assert.match(result.content[0].text, /not found|Error/);
  });

  it("extracts text from real image", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const imagePath = "C:/Users/Lenovo/OneDrive/Pictures/KelasVibeCoding3.png";
    const result = await tool.execute(
      "test-3",
      { path: imagePath },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    const text = result.content[0].text;
    assert.ok(text.length > 0, "should return some text");
    assert.ok(
      text.includes("Kelas") || text.includes("Vibe") || text.includes("CODING"),
      `should detect text from image, got: ${text}`,
    );
  });

  it("detail mode includes confidence scores", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const imagePath = "C:/Users/Lenovo/OneDrive/Pictures/KelasVibeCoding3.png";
    const result = await tool.execute(
      "test-4",
      { path: imagePath, detail: true },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    const text = result.content[0].text;
    assert.match(text, /conf:/, "detail mode should include confidence");
    assert.match(text, /pos:/, "detail mode should include position");
  });

  it("extracts text from PDF", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const pdfPath = "C:/Users/Lenovo/Downloads/MeritReport_Sample Jc1c_Term1-2.pdf";
    const result = await tool.execute(
      "test-5",
      { path: pdfPath },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    const text = result.content[0].text;
    assert.ok(text.length > 0, "should return some text from PDF");
    assert.ok(
      text.includes("Merit") || text.includes("Report") || text.includes("Bina Bangsa"),
      `should detect text from PDF, got: ${text.slice(0, 200)}`,
    );
  });

  it("PDF page selection works", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const pdfPath = "C:/Users/Lenovo/Downloads/MeritReport_Sample Jc1c_Term1-2.pdf";
    const result = await tool.execute(
      "test-6",
      { path: pdfPath, pages: "1" },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    const text = result.content[0].text;
    assert.ok(text.includes("Page 1"), "should show page 1 header");
    assert.ok(text.length > 0, "should return text from selected page");
  });

  it("OCR from Imgur URL", async () => {
    const { instance, tools } = createMockPi();
    createExtension()(instance);
    const tool = tools.get("vision-ocr");
    assert.ok(tool, "tool should exist");
    const result = await tool.execute(
      "test-7",
      { path: "https://imgur.com/ODylPjg" },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() },
    );
    const text = result.content[0].text;
    assert.ok(text.length > 0, "should return text from Imgur image");
    assert.ok(
      text.includes("OCR Result") || text.includes("Detected"),
      `should format as OCR result, got: ${text.slice(0, 300)}`,
    );
  });
});
