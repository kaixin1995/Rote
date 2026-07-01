import mcpErrors from './errorCodes.json';
import rawDefinitions from './toolDefinitions.json';
import type { McpTool, McpToolDefinition } from './types';

const toolDefinitions = rawDefinitions as McpToolDefinition[];
const definitionByName = new Map(
  toolDefinitions.map((definition) => [definition.name, definition])
);

export function defineMcpTool(name: string, handler: McpTool['handler']): McpTool {
  const definition = definitionByName.get(name);
  if (!definition) {
    throw new Error(mcpErrors.toolDefinitionMissingPrefix + name);
  }
  return { ...definition, handler };
}

export function getToolDefinitionsForScopes(scopes: string[]): McpToolDefinition[] {
  return toolDefinitions.filter((tool) =>
    tool.requiredScopes.every((scope) => scopes.includes(scope))
  );
}
