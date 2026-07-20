export type PiCommandDefinition = {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<void>;
};

export type PiInstance = {
  id: string;
  name: string;
  config: Record<string, unknown>;
};

export type PiToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<ToolExecutionResult>;
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
