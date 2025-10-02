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
            name: 'Read',
            description: 'Read file contents with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: 'Path to file' },
                offset: { type: 'number', description: 'Line offset' },
                limit: { type: 'number', description: 'Line limit' },
              },
              required: ['file_path'],
            },
          },
          {
            name: 'Write',
            description: 'Write file contents with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['file_path', 'content'],
            },
          },
          {
            name: 'Edit',
            description: 'Edit file contents with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                old_string: { type: 'string' },
                new_string: { type: 'string' },
                replace_all: { type: 'boolean' },
              },
              required: ['file_path', 'old_string', 'new_string'],
            },
          },
          {
            name: 'Bash',
            description: 'Execute bash commands with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string' },
                description: { type: 'string' },
                timeout: { type: 'number' },
                run_in_background: { type: 'boolean' },
              },
              required: ['command'],
            },
          },
          {
            name: 'Glob',
            description: 'Find files by pattern with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: { type: 'string' },
                path: { type: 'string' },
              },
              required: ['pattern'],
            },
          },
          {
            name: 'Grep',
            description: 'Search file contents with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: { type: 'string' },
                path: { type: 'string' },
                glob: { type: 'string' },
                output_mode: { type: 'string' },
                '-i': { type: 'boolean' },
                '-n': { type: 'boolean' },
                '-C': { type: 'number' },
                '-A': { type: 'number' },
                '-B': { type: 'number' },
              },
              required: ['pattern'],
            },
          },
          {
            name: 'NotebookEdit',
            description: 'Edit Jupyter notebook cells with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                notebook_path: { type: 'string' },
                cell_id: { type: 'string' },
                cell_type: { type: 'string', enum: ['code', 'markdown'] },
                new_source: { type: 'string' },
                edit_mode: { type: 'string', enum: ['replace', 'insert', 'delete'] },
              },
              required: ['notebook_path', 'new_source'],
            },
          },
          {
            name: 'WebFetch',
            description: 'Fetch content from a URL with permission checking',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL to fetch' },
                prompt: { type: 'string', description: 'Prompt for processing' },
              },
              required: ['url', 'prompt'],
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
    // Check permission first
    const approved = await checkPermission(name, args);

    if (!approved) {
      sendResponse(request.id, {
        content: [{ type: 'text', text: 'Permission denied by user' }],
        isError: true,
      });
      return;
    }

    // Execute the tool
    let result: string;
    switch (name) {
      case 'Read':
        result = await executeRead(args);
        break;
      case 'Write':
        result = await executeWrite(args);
        break;
      case 'Edit':
        result = await executeEdit(args);
        break;
      case 'Bash':
        result = await executeBash(args);
        break;
      case 'Glob':
        result = await executeGlob(args);
        break;
      case 'Grep':
        result = await executeGrep(args);
        break;
      case 'NotebookEdit':
        result = await executeNotebookEdit(args);
        break;
      case 'WebFetch':
        result = await executeWebFetch(args);
        break;
      default:
        sendError(request.id, -32601, `Unknown tool: ${name}`);
        return;
    }

    sendResponse(request.id, {
      content: [{ type: 'text', text: result }],
    });
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

  // Wait for response file (no timeout - wait indefinitely for user response)
  const response = await waitForResponse(responseFile);

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
async function waitForResponse(responseFile: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
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

/**
 * Tool execution functions
 */
async function executeRead(args: any): Promise<string> {
  const { file_path, offset, limit } = args;

  const content = fs.readFileSync(file_path, 'utf8');
  const lines = content.split('\n');

  const start = offset || 0;
  const end = limit ? start + limit : lines.length;
  const selectedLines = lines.slice(start, end);

  // Format with line numbers like cat -n
  return selectedLines
    .map((line, idx) => `${start + idx + 1}\t${line}`)
    .join('\n');
}

async function executeWrite(args: any): Promise<string> {
  const { file_path, content } = args;
  fs.writeFileSync(file_path, content, 'utf8');
  return `File written successfully: ${file_path}`;
}

async function executeEdit(args: any): Promise<string> {
  const { file_path, old_string, new_string, replace_all } = args;

  let content = fs.readFileSync(file_path, 'utf8');

  if (replace_all) {
    content = content.split(old_string).join(new_string);
  } else {
    const index = content.indexOf(old_string);
    if (index === -1) {
      throw new Error('old_string not found in file');
    }
    content = content.substring(0, index) + new_string + content.substring(index + old_string.length);
  }

  fs.writeFileSync(file_path, content, 'utf8');
  return `File edited successfully: ${file_path}`;
}

async function executeBash(args: any): Promise<string> {
  const { command, timeout = 120000, run_in_background } = args;
  const cp = await import('child_process');

  // Auto-detect long-running commands that should run in background
  const longRunningPatterns = [
    /npm\s+run\s+(dev|start|serve)/,
    /yarn\s+(dev|start|serve)/,
    /pnpm\s+(dev|start|serve)/,
    /ng\s+serve/,
    /vite(\s+|$)/,
    /webpack-dev-server/,
    /next\s+dev/,
  ];

  const shouldRunInBackground = run_in_background ||
    longRunningPatterns.some(pattern => pattern.test(command.trim()));

  // Handle background processes (long-running commands like npm run dev)
  if (shouldRunInBackground) {
    return new Promise((resolve, reject) => {
      try {
        // Spawn detached process that continues running
        const proc = cp.spawn(command, [], {
          shell: true,
          detached: true,
          stdio: 'ignore', // Don't capture output for background processes
        });

        // Unref so parent process can exit
        proc.unref();

        resolve(`Background process started (PID: ${proc.pid})\nNote: Use your terminal to monitor output and stop the process.`);
      } catch (error: any) {
        reject(new Error(`Failed to start background process: ${error.message}`));
      }
    });
  }

  // Handle normal foreground processes
  return new Promise((resolve, reject) => {
    // exec() uses shell by default, which properly handles npm and other commands
    cp.exec(command, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error: any, stdout: any, stderr: any) => {
      if (error) {
        // Include both stderr and error message for better debugging
        const errorMsg = stderr ? `${stderr}\n${error.message}` : error.message;
        reject(new Error(errorMsg));
      } else {
        resolve(stdout || '');
      }
    });
  });
}

async function executeGlob(args: any): Promise<string> {
  const { pattern, path: searchPath } = args;
  const cp = await import('child_process');

  // Use find command as a fallback for glob functionality
  const cwd = searchPath || process.cwd();

  // Convert glob pattern to find-compatible pattern
  const findPattern = pattern.replace(/\*\*/g, '*').replace(/\*/g, '*');

  return new Promise((resolve, reject) => {
    // Use a simple approach: list all files and filter with glob pattern in Node
    const { readdirSync, statSync } = fs;

    function getAllFiles(dir: string, pattern: string): string[] {
      const results: string[] = [];

      try {
        const files = readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);

          try {
            const stat = statSync(filePath);

            if (stat.isDirectory()) {
              // Recurse into subdirectories if pattern has **
              if (pattern.includes('**')) {
                results.push(...getAllFiles(filePath, pattern));
              }
            } else {
              // Simple pattern matching
              const globRegex = new RegExp(
                '^' + pattern
                  .replace(/\*\*/g, '.*')
                  .replace(/\*/g, '[^/\\\\]*')
                  .replace(/\./g, '\\.')
                  .replace(/\?/g, '.') + '$'
              );

              if (globRegex.test(filePath) || globRegex.test(file)) {
                results.push(filePath);
              }
            }
          } catch (err) {
            // Skip files we can't stat
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }

      return results;
    }

    try {
      const files = getAllFiles(cwd, pattern);
      resolve(files.join('\n'));
    } catch (error: any) {
      reject(error);
    }
  });
}

async function executeGrep(args: any): Promise<string> {
  const { pattern, path: searchPath, glob, output_mode, '-i': ignoreCase, '-n': lineNumbers, '-C': context, '-A': after, '-B': before } = args;
  const cp = await import('child_process');

  // Build ripgrep command
  let rgArgs = ['--color', 'never'];

  if (ignoreCase) rgArgs.push('-i');
  if (lineNumbers) rgArgs.push('-n');
  if (context) rgArgs.push('-C', String(context));
  if (after) rgArgs.push('-A', String(after));
  if (before) rgArgs.push('-B', String(before));
  if (glob) rgArgs.push('--glob', glob);

  if (output_mode === 'files_with_matches') {
    rgArgs.push('-l');
  } else if (output_mode === 'count') {
    rgArgs.push('-c');
  }

  rgArgs.push(pattern);
  if (searchPath) rgArgs.push(searchPath);

  return new Promise((resolve, reject) => {
    cp.execFile('rg', rgArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // rg returns exit code 1 when no matches found
      if (error && error.code !== 1) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout || 'No matches found');
      }
    });
  });
}

async function executeWebFetch(args: any): Promise<string> {
  const { url, prompt } = args;

  try {
    // Use Node.js built-in fetch (available in Node 18+)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Claude-MCP-Server/1.0',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let content: string;

    if (contentType.includes('application/json')) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else {
      content = await response.text();
    }

    // Return the fetched content
    // Note: The prompt parameter is meant for AI processing, but we can't do that here
    // Just return the raw content
    return `Fetched from ${url}:\n\n${content}`;
  } catch (error: any) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

async function executeNotebookEdit(args: any): Promise<string> {
  const { notebook_path, cell_id, cell_type, new_source, edit_mode } = args;

  // Read the notebook file
  const notebookContent = fs.readFileSync(notebook_path, 'utf8');
  const notebook = JSON.parse(notebookContent);

  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    throw new Error('Invalid notebook format');
  }

  if (edit_mode === 'insert') {
    // Insert new cell
    const newCell = {
      cell_type: cell_type || 'code',
      metadata: {},
      source: new_source.split('\n'),
      outputs: cell_type === 'code' ? [] : undefined,
      execution_count: cell_type === 'code' ? null : undefined,
    };

    if (cell_id) {
      // Find cell and insert after it
      const index = notebook.cells.findIndex((c: any) => c.id === cell_id);
      if (index !== -1) {
        notebook.cells.splice(index + 1, 0, newCell);
      } else {
        notebook.cells.push(newCell);
      }
    } else {
      notebook.cells.push(newCell);
    }
  } else if (edit_mode === 'delete') {
    // Delete cell
    if (cell_id) {
      const index = notebook.cells.findIndex((c: any) => c.id === cell_id);
      if (index !== -1) {
        notebook.cells.splice(index, 1);
      }
    }
  } else {
    // Replace cell content (default)
    if (cell_id) {
      const cell = notebook.cells.find((c: any) => c.id === cell_id);
      if (cell) {
        cell.source = new_source.split('\n');
        if (cell_type) {
          cell.cell_type = cell_type;
        }
      }
    } else {
      // No cell_id specified, replace first cell or add new one
      if (notebook.cells.length > 0) {
        notebook.cells[0].source = new_source.split('\n');
      } else {
        notebook.cells.push({
          cell_type: cell_type || 'code',
          metadata: {},
          source: new_source.split('\n'),
          outputs: [],
          execution_count: null,
        });
      }
    }
  }

  // Write back to file
  fs.writeFileSync(notebook_path, JSON.stringify(notebook, null, 2), 'utf8');
  return `Notebook edited successfully: ${notebook_path}`;
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