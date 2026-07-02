import type { HonoContext } from '../types/hono';

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  requiredScopes: string[];
  inputSchema: Record<string, any>;
};

export type McpTool = McpToolDefinition & {
  handler: (c: HonoContext, args: Record<string, any>) => Promise<any>;
};
