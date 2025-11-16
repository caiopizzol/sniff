// MCP (Model Context Protocol) Types

/**
 * MCP Server configuration in agent config
 */
export type MCPServerConfig = {
  type: 'url';
  url: string;
  name: string;
  authorization_token?: string;
  tool_configuration?: {
    enabled?: boolean;
    allowed_tools?: string[];
    disabled_tools?: string[];
  };
};

/**
 * MCP request protocol (JSON-RPC 2.0 format)
 */
export type MCPRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method:
    | 'initialize'
    | 'ping'
    | 'tools/list'
    | 'tools/call'
    | 'notifications/initialized'
    | string;
  params?: any;
};

/**
 * MCP tool definition
 */
export type MCPToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
};

/**
 * MCP response protocol (JSON-RPC 2.0 format)
 */
export type MCPResponse = {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
};

/**
 * MCP tool execution context
 */
export type MCPExecutionContext = {
  userId: string;
  workspaceId?: string;
  sessionId?: string;
  connectionId: string;
  provider: string;
};

/**
 * MCP tool executor function
 */
export type MCPToolExecutor<TInput = any, TOutput = any> = (
  input: TInput,
  connectionId: string,
) => Promise<TOutput>;

/**
 * MCP tool registry entry
 */
export type MCPToolRegistryEntry<TInput = any, TOutput = any> = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: MCPToolExecutor<TInput, TOutput>;
};
