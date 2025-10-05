import * as http from 'http';
import * as crypto from 'crypto';

export interface PermissionRequestFromHook {
  tool_name: string;
  tool_input: any;
  path: string;
  context: any;
}

export interface PermissionDecision {
  decision: 'approve' | 'deny';
  reason?: string;
  alwaysAllow?: boolean;
}

export class PermissionServer {
  private server: http.Server | null = null;
  private pendingRequests: Map<string, {
    resolve: (decision: PermissionDecision) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(
    private port: number,
    private onPermissionRequest: (sessionId: string, tool: string, path: string, message: string) => Promise<{ allowed: boolean; alwaysAllow?: boolean }>,
    private getSessionByClaudeId: (claudeSessionId: string) => string | null
  ) {}

  /**
   * Starts the HTTP server that listens for permission requests from hooks
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle OPTIONS (preflight)
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Handle POST to /permission-request
        if (req.method === 'POST' && req.url === '/permission-request') {
          try {
            const body = await this.readRequestBody(req);
            const request: PermissionRequestFromHook = JSON.parse(body);

            console.log('[PERMISSION SERVER] Received request:', request);

            // Extract Claude's session ID from context
            const claudeSessionId = request.context?.session_id;

            // Map Claude's session ID to our Electron session ID
            const sessionId = claudeSessionId ? this.getSessionByClaudeId(claudeSessionId) : null;

            if (!sessionId) {
              console.error('[PERMISSION SERVER] Could not find session for Claude session ID:', claudeSessionId);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                decision: 'deny',
                reason: 'Session not found'
              }));
              return;
            }

            // Create a more readable message
            const message = this.formatPermissionMessage(request);

            // Request permission from the main handler
            const result = await this.onPermissionRequest(
              sessionId,
              request.tool_name,
              request.path,
              message
            );

            // Send response
            const decision: PermissionDecision = {
              decision: result.allowed ? 'approve' : 'deny',
              reason: result.allowed ? 'Approved by user' : 'Denied by user',
              alwaysAllow: result.alwaysAllow
            };

            console.log('[PERMISSION SERVER] Sending decision:', decision);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(decision));

          } catch (error: any) {
            console.error('[PERMISSION SERVER] Error handling request:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              decision: 'deny',
              reason: `Server error: ${error.message}`
            }));
          }
        } else {
          // Unknown endpoint
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.server.listen(this.port, () => {
        console.log(`[PERMISSION SERVER] Listening on http://localhost:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('[PERMISSION SERVER] Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stops the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Server shutting down'));
        }
        this.pendingRequests.clear();

        this.server.close(() => {
          console.log('[PERMISSION SERVER] Server stopped');
          resolve();
        });
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Reads the request body as a string
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Formats a human-readable permission message
   */
  private formatPermissionMessage(request: PermissionRequestFromHook): string {
    const tool = request.tool_name;
    const path = request.path;

    switch (tool) {
      case 'Read':
        return `Read file: ${path}`;
      case 'Write':
        return `Write file: ${path}`;
      case 'Edit':
        return `Edit file: ${path}`;
      case 'Bash':
        return `Execute command: ${path}`;
      case 'Glob':
        return `Search files: ${path}`;
      case 'Grep':
        return `Search content: ${path}`;
      case 'WebFetch':
        return `Fetch URL: ${path}`;
      case 'NotebookEdit':
        return `Edit notebook: ${path}`;
      default:
        return `${tool}: ${path}`;
    }
  }
}
