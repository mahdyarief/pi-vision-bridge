export type CommandContext = {
  pi: PiInstance;
  cwd: string;
  env: Record<string, string | undefined>;
  ui?: {
    notify: (message: string, level?: "info" | "warn" | "error") => void;
  };
};

export type PiCommandDefinition = {
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<void>;
};

export type PiInstance = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  registerTool: (tool: PiToolDefinition) => void;
  registerCommand: (name: string, command: PiCommandDefinition) => void;
};

export type PiToolDefinition = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    ctx: RuntimeContext,
  ) => Promise<ToolExecutionResult>;
};

export type RuntimeContext = {
  pi: PiInstance;
  cwd: string;
  env: Record<string, string | undefined>;
};

export type ToolExecutionResult = {
  content: Array<{ type: string; text?: string; image_url?: string }>;
  details?: Record<string, unknown>;
};
