#!/usr/bin/env node
/**
 * MCP Server for handling file-based permissions
 * Communicates with Electron app via permission-requests directory
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface MCPRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: { code: number; message: string };
}

// Get permissions directory from environment or use default
const PERMISSIONS_DIR = process.env.PERMISSIONS_DIR || path.join(process.cwd(), '.permissions');

// Ensure permissions directory exists
if (!fs.existsSync(PERMISSIONS_DIR)) {
  fs.mkdirSync(PERMISSIONS_DIR, { recursive: true });
}

let buffer = '';

// Set up stdin/stdout for JSON-RPC communication
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  processBuffer();
});

function processBuffer() {
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (line.trim()) {
      try {
        const request: MCPRequest = JSON.parse(line);
        handleRequest(request).catch(error => {
          sendError(request.id, -32603, error.message);
        });
      } catch (error) {
        console.error('[MCP] Failed to parse request:', error);
      }
    }
  }
}

async function handleRequest(request: MCPRequest): Promise<void> {
  console.error('[MCP] Received request:', request.method);

  switch (request.method) {
    case 'initialize':
      sendResponse(request.id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'claude-permissions-server',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
        },
      });
      break;

    case 'tools/list':
      sendResponse(request.id, {
        tools: [
          {
            name: 'approval_prompt',
            description: 'Request user permission to execute a tool',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: {
                  type: 'string',
                  description: 'The name of the tool requesting permission',
                },
                input: {
                  type: 'object',
                  description: 'The input for the tool',
                },
                tool_use_id: {
                  type: 'string',
                  description: 'The unique tool use request ID',
                },
              },
              required: ['tool_name', 'input'],
            },
          },
        ],
      });
      break;

    case 'tools/call':
      await handleToolCall(request);
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    default:
      sendError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

async function handleToolCall(request: MCPRequest): Promise<void> {
  const { name, arguments: args } = request.params;
  console.error('[MCP] Tool call:', name, JSON.stringify(args));

  try {
    if (name === 'approval_prompt') {
      // Handle permission approval
      const { tool_name, input } = args;
      const approved = await checkPermission(tool_name, input);

      console.error('[MCP] Permission check result:', approved);

      const behavior = approved ? 'allow' : 'deny';
      const result = {
        behavior,
        updatedInput: approved ? input : undefined,
        message: approved ? undefined : 'Permission denied by user',
      };

      sendResponse(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    } else {
      sendError(request.id, -32601, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error('[MCP] Tool call error:', error);
    sendError(request.id, -32000, error.message);
  }
}

/**
 * Check if permission is granted via permissions.json or file system prompt
 */
async function checkPermission(toolName: string, input: any): Promise<boolean> {
  // Check permissions.json first
  const permissionsFile = path.join(PERMISSIONS_DIR, 'permissions.json');

  if (fs.existsSync(permissionsFile)) {
    try {
      const permissions = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
      const toolPermission = permissions.alwaysAllow?.[toolName];

      console.error('[MCP] Checking permission for', toolName, ':', toolPermission);

      // If explicitly allowed
      if (toolPermission === true) {
        return true;
      }

      // For Bash, check command patterns
      if (Array.isArray(toolPermission) && toolName === 'Bash' && input.command) {
        const command = input.command.trim();
        const allowed = toolPermission.some((allowedCmd: string) => {
          if (allowedCmd.includes('*')) {
            const pattern = allowedCmd.replace(/\*/g, '.*');
            return new RegExp(`^${pattern}$`).test(command);
          }
          return command.startsWith(allowedCmd);
        });

        if (allowed) {
          return true;
        }
      }
    } catch (error) {
      console.error('[MCP] Error reading permissions.json:', error);
    }
  }

  // If not in permissions.json, request via file system
  return await requestPermissionViaFile(toolName, input);
}

/**
 * Request permission via file system
 */
async function requestPermissionViaFile(tool: string, input: any): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const requestFile = path.join(PERMISSIONS_DIR, `${requestId}.request`);
  const responseFile = path.join(PERMISSIONS_DIR, `${requestId}.response`);

  // Write request file
  const request = {
    id: requestId,
    tool: tool,
    input: input,
    timestamp: new Date().toISOString(),
  };

  console.error('[MCP] Writing permission request:', requestFile);
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));

  // Wait for response file
  const response = await waitForResponse(responseFile, 60000); // 60 second timeout

  // Clean up
  try {
    if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
    if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
  } catch (error) {
    console.error('[MCP] Cleanup error:', error);
  }

  return response.approved;
}

/**
 * Wait for response file to appear
 */
async function waitForResponse(responseFile: string, timeout: number): Promise<any> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Permission request timed out'));
        return;
      }

      if (fs.existsSync(responseFile)) {
        clearInterval(checkInterval);
        try {
          const content = fs.readFileSync(responseFile, 'utf8');
          const response = JSON.parse(content);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      }
    }, 100); // Check every 100ms
  });
}

function sendResponse(id: string | number, result: any): void {
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id,
    result,
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: string | number, code: number, message: string): void {
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// Handle process termination
process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  process.exit(0);
});

console.error('[MCP] Server started, permissions dir:', PERMISSIONS_DIR);