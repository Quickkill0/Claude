import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Session, SessionConfig, ClaudeStreamData } from '../shared/types';
import * as crypto from 'crypto';
import { app } from 'electron';
import { MessageParser } from './MessageParser';
import { ErrorHandler } from './ErrorHandler';

interface ActiveSession {
  session: Session;
  process?: cp.ChildProcess;
  rawOutput: string;
  permissionRequestsPath?: string;
  permissionWatcher?: fs.FSWatcher;
  processingRequests?: Set<string>;
  parser?: MessageParser;
}

export class MultiSessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(
    private onStreamData: (sessionId: string, data: ClaudeStreamData) => void,
    private onPermissionRequest?: (sessionId: string, tool: string, path: string, message: string) => Promise<boolean>
  ) {}

  /**
   * Initializes permission directory for a session
   */
  private async initializePermissionDirectory(sessionId: string): Promise<string> {
    const userDataPath = app.getPath('userData');
    const permissionsPath = path.join(userDataPath, 'permission-requests', sessionId);

    // Create directory if it doesn't exist
    if (!fs.existsSync(permissionsPath)) {
      fs.mkdirSync(permissionsPath, { recursive: true });
    }

    return permissionsPath;
  }

  /**
   * Sets up file watcher for permission requests
   */
  private setupPermissionWatcher(sessionId: string, permissionsPath: string): void {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    // Clean up existing watcher if any
    if (activeSession.permissionWatcher) {
      activeSession.permissionWatcher.close();
    }

    // Create default permissions.json in BOTH locations:
    // 1. In permissions directory for MCP server
    // 2. In working directory for Claude CLI to read directly
    const defaultPermissions = {
      alwaysAllow: {
        // Minimal auto-approved list - users should add tools they trust via permission prompts
      },
    };

    // Create permissions.json only if it doesn't exist yet
    // This preserves "Accept Always" choices across multiple messages in the same session
    const permissionsFile = path.join(permissionsPath, 'permissions.json');
    if (!fs.existsSync(permissionsFile)) {
      fs.writeFileSync(permissionsFile, JSON.stringify(defaultPermissions, null, 2));
      console.log('[PERMISSIONS] Created new permissions.json in:', permissionsPath);
    } else {
      console.log('[PERMISSIONS] Using existing permissions.json from:', permissionsPath);
    }

    // ALSO create/sync in working directory (Claude CLI reads from here)
    const workingDirSession = this.sessions.get(sessionId);
    if (workingDirSession) {
      const workingDirPermissions = path.join(workingDirSession.session.workingDirectory, '.claude', 'permissions.json');
      const claudeDir = path.join(workingDirSession.session.workingDirectory, '.claude');

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Copy from session permissions to working dir to keep them in sync
      if (fs.existsSync(permissionsFile)) {
        const sessionPermissions = fs.readFileSync(permissionsFile, 'utf8');
        fs.writeFileSync(workingDirPermissions, sessionPermissions);
        console.log('[PERMISSIONS] Synced permissions to working dir:', workingDirPermissions);
      }
    }

    // Initialize set to track in-progress requests
    if (!activeSession.processingRequests) {
      activeSession.processingRequests = new Set<string>();
    }

    // Watch for .request files
    const watcher = fs.watch(permissionsPath, async (eventType, filename) => {
      if (!filename || !filename.endsWith('.request')) return;

      const requestPath = path.join(permissionsPath, filename);

      // Skip if already processing this file
      if (activeSession.processingRequests?.has(filename)) {
        console.log('[PERMISSIONS] Skipping duplicate request:', filename);
        return;
      }

      // Mark as processing
      activeSession.processingRequests?.add(filename);

      // Small delay to ensure file is fully written (reduced from 100ms for faster response)
      setTimeout(async () => {
        try {
          if (!fs.existsSync(requestPath)) {
            activeSession.processingRequests?.delete(filename);
            return;
          }

          const content = fs.readFileSync(requestPath, 'utf8');
          const request = JSON.parse(content);

          console.log('[PERMISSIONS] Received request:', request);

          if (this.onPermissionRequest) {
            // Extract appropriate path/command based on tool type
            let pathInfo = 'unknown';
            if (request.input) {
              if (request.input.command) {
                pathInfo = request.input.command;
              } else if (request.input.file_path) {
                pathInfo = request.input.file_path;
              } else if (request.input.pattern) {
                pathInfo = request.input.pattern;
              }
            }

            // Ask for permission
            const allowed = await this.onPermissionRequest(
              sessionId,
              request.tool || 'unknown',
              pathInfo,
              `${request.tool} permission requested`
            );

            // Write response file
            const responseFile = requestPath.replace('.request', '.response');
            const response = {
              id: request.id,
              approved: allowed,
              timestamp: new Date().toISOString(),
            };

            fs.writeFileSync(responseFile, JSON.stringify(response));
            console.log('[PERMISSIONS] Wrote response:', allowed);

            // Save to permissions.json if always allow
            if (allowed && request.alwaysAllow) {
              this.saveAlwaysAllowPermission(permissionsPath, request);
            }

            // Clean up request file
            fs.unlinkSync(requestPath);
          }
        } catch (error) {
          const errorInfo = ErrorHandler.handlePermissionError(error);
          console.error('[PERMISSIONS] Error handling request:', ErrorHandler.formatError(errorInfo));
        } finally {
          // Remove from processing set
          activeSession.processingRequests?.delete(filename);
        }
      }, 50);
    });

    activeSession.permissionWatcher = watcher;
  }

  /**
   * Saves always-allow permission to permissions.json
   */
  private saveAlwaysAllowPermission(permissionsPath: string, request: any): void {
    try {
      const permissionsFile = path.join(permissionsPath, 'permissions.json');
      let permissions: any = { alwaysAllow: {} };

      if (fs.existsSync(permissionsFile)) {
        permissions = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
      }

      const toolName = request.tool;
      if (toolName === 'Bash' && request.input?.command) {
        // For Bash, store command patterns
        if (!permissions.alwaysAllow[toolName]) {
          permissions.alwaysAllow[toolName] = [];
        }
        if (Array.isArray(permissions.alwaysAllow[toolName])) {
          const pattern = this.getCommandPattern(request.input.command);
          if (!permissions.alwaysAllow[toolName].includes(pattern)) {
            permissions.alwaysAllow[toolName].push(pattern);
          }
        }
      } else {
        // For other tools, allow all
        permissions.alwaysAllow[toolName] = true;
      }

      fs.writeFileSync(permissionsFile, JSON.stringify(permissions, null, 2));
      console.log(`[PERMISSIONS] Saved always-allow for ${toolName}`);
    } catch (error) {
      console.error('[PERMISSIONS] Error saving always-allow:', error);
    }
  }

  /**
   * Gets command pattern for Bash commands
   */
  private getCommandPattern(command: string): string {
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0) return command;

    const baseCmd = parts[0];
    const subCmd = parts.length > 1 ? parts[1] : '';

    // Common patterns
    const patterns: [string, string, string][] = [
      ['npm', 'install', 'npm install *'],
      ['npm', 'i', 'npm i *'],
      ['npm', 'run', 'npm run *'],
      ['git', 'add', 'git add *'],
      ['git', 'commit', 'git commit *'],
      ['git', 'push', 'git push *'],
    ];

    for (const [cmd, sub, pattern] of patterns) {
      if (baseCmd === cmd && (sub === '' || subCmd === sub)) {
        return pattern;
      }
    }

    return command;
  }

  /**
   * Creates a new session
   */
  async createSession(config?: SessionConfig): Promise<Session> {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Extract folder name from working directory
    const workingDir = config?.workingDirectory || process.cwd();
    const folderName = workingDir.split(/[/\\]/).filter(Boolean).pop() || 'Session';

    const session: Session = {
      id: sessionId,
      name: folderName,
      workingDirectory: workingDir,
      model: (config?.model as any) || 'default',
      createdAt: now,
      lastActive: now,
      isActive: false,
      isProcessing: false,
      isOpen: true, // Mark as open when created
    };

    this.sessions.set(sessionId, {
      session,
      rawOutput: '',
      parser: new MessageParser(),
    });

    // If this is the first session, make it active
    if (this.sessions.size === 1) {
      this.activeSessionId = sessionId;
      session.isActive = true;
    }

    return session;
  }

  /**
   * Switches to a different session
   */
  async switchToSession(sessionId: string): Promise<Session | null> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return null;
    }

    // Deactivate current session
    if (this.activeSessionId) {
      const current = this.sessions.get(this.activeSessionId);
      if (current) {
        current.session.isActive = false;
      }
    }

    // Activate new session
    this.activeSessionId = sessionId;
    activeSession.session.isActive = true;
    activeSession.session.lastActive = new Date().toISOString();

    return activeSession.session;
  }

  /**
   * Deletes a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return false;
    }

    // Stop the process if running
    if (activeSession.process) {
      activeSession.process.kill('SIGTERM');
    }

    // Close permission watcher
    if (activeSession.permissionWatcher) {
      activeSession.permissionWatcher.close();
    }

    // Clear parser state
    if (activeSession.parser) {
      activeSession.parser.clearSession(sessionId);
    }

    this.sessions.delete(sessionId);

    // If this was the active session, switch to another
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      const firstSession = Array.from(this.sessions.values())[0];
      if (firstSession) {
        await this.switchToSession(firstSession.session.id);
      }
    }

    return true;
  }

  /**
   * Gets all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map((s) => s.session);
  }

  /**
   * Saves a permission as always-allow for a specific session
   */
  async savePermissionForSession(sessionId: string, tool: string, filePath: string, input?: any): Promise<void> {
    const permissionsPath = await this.initializePermissionDirectory(sessionId);
    const request = {
      tool,
      path: filePath,
      input,
    };
    this.saveAlwaysAllowPermission(permissionsPath, request);

    // Also update the working directory permissions.json
    const activeSession = this.sessions.get(sessionId);
    if (activeSession) {
      const workingDirPermissions = path.join(activeSession.session.workingDirectory, '.claude', 'permissions.json');
      if (fs.existsSync(workingDirPermissions)) {
        this.saveAlwaysAllowPermission(path.join(activeSession.session.workingDirectory, '.claude'), request);
      }

      // Update session object's sessionPermissions array
      const permission = {
        tool,
        path: filePath,
        allowed: true,
        createdAt: new Date().toISOString(),
      };

      if (!activeSession.session.sessionPermissions) {
        activeSession.session.sessionPermissions = [];
      }

      // Check if permission already exists
      const exists = activeSession.session.sessionPermissions.some(
        p => p.tool === tool && p.path === filePath
      );

      if (!exists) {
        activeSession.session.sessionPermissions.push(permission);
      }
    }
  }

  /**
   * Removes a permission from a session
   */
  async removePermissionForSession(sessionId: string, index: number): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || !activeSession.session.sessionPermissions) {
      return;
    }

    const permission = activeSession.session.sessionPermissions[index];
    if (!permission) return;

    // Remove from session object
    activeSession.session.sessionPermissions.splice(index, 1);

    // Update permissions.json files
    const permissionsPath = await this.initializePermissionDirectory(sessionId);
    this.removePermissionFromFile(permissionsPath, permission);

    // Also update working directory permissions.json
    const workingDirPermissions = path.join(activeSession.session.workingDirectory, '.claude');
    if (fs.existsSync(workingDirPermissions)) {
      this.removePermissionFromFile(workingDirPermissions, permission);
    }
  }

  /**
   * Removes a permission from permissions.json file
   */
  private removePermissionFromFile(permissionsDir: string, permission: import('../shared/types').PermissionRule): void {
    try {
      const permissionsFile = path.join(permissionsDir, 'permissions.json');
      if (!fs.existsSync(permissionsFile)) return;

      let permissions: any = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));

      if (!permissions.alwaysAllow) return;

      const toolName = permission.tool;

      if (toolName === 'Bash' && Array.isArray(permissions.alwaysAllow[toolName])) {
        // For Bash, remove the specific command pattern
        const pattern = permission.path || '';
        permissions.alwaysAllow[toolName] = permissions.alwaysAllow[toolName].filter(
          (p: string) => p !== pattern
        );

        // Remove the tool entry if no patterns left
        if (permissions.alwaysAllow[toolName].length === 0) {
          delete permissions.alwaysAllow[toolName];
        }
      } else {
        // For other tools, remove the entire tool entry
        delete permissions.alwaysAllow[toolName];
      }

      fs.writeFileSync(permissionsFile, JSON.stringify(permissions, null, 2));
      console.log(`[PERMISSIONS] Removed permission for ${toolName}`);
    } catch (error) {
      console.error('[PERMISSIONS] Error removing permission:', error);
    }
  }

  /**
   * Loads permissions from permissions.json into session object
   */
  async loadSessionPermissions(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    try {
      const permissionsPath = await this.initializePermissionDirectory(sessionId);
      const permissionsFile = path.join(permissionsPath, 'permissions.json');

      if (!fs.existsSync(permissionsFile)) return;

      const permissions: any = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));

      if (!permissions.alwaysAllow) return;

      activeSession.session.sessionPermissions = [];

      // Convert permissions.json format to PermissionRule array
      for (const [tool, value] of Object.entries(permissions.alwaysAllow)) {
        if (Array.isArray(value)) {
          // Bash commands
          for (const pattern of value) {
            activeSession.session.sessionPermissions.push({
              tool,
              path: pattern,
              allowed: true,
              createdAt: new Date().toISOString(),
            });
          }
        } else if (value === true) {
          // Other tools
          activeSession.session.sessionPermissions.push({
            tool,
            allowed: true,
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('[PERMISSIONS] Error loading session permissions:', error);
    }
  }

  /**
   * Restores sessions from persistence
   */
  restoreSessions(sessions: Session[], messagesMap: Map<string, any>): void {
    for (const session of sessions) {
      // Reset processing state on app restart
      session.isProcessing = false;

      this.sessions.set(session.id, {
        session,
        rawOutput: '',
        parser: new MessageParser(),
      });

      // Set active session if one was active
      if (session.isActive) {
        this.activeSessionId = session.id;
      }
    }
  }

  /**
   * Sends a message to Claude in a specific session
   */
  async sendMessage(sessionId: string, message: string, config?: SessionConfig): Promise<boolean> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return false;
    }

    // Stop any existing process first
    if (activeSession.process) {
      console.log('[SEND MESSAGE] Stopping existing process before starting new one');
      this.stopSession(sessionId);
      // Give it a moment to clean up
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const session = activeSession.session;
    session.isProcessing = true;
    session.lastActive = new Date().toISOString();

    // Prepend "ultrathink" if show reasoning mode is enabled
    const showReasoning = config?.thinkingMode || session.thinkingMode;
    if (showReasoning) {
      message = `ultrathink\n\n${message}`;
    }

    // Prepend planning instructions if plan mode is enabled
    const planMode = config?.planMode || session.planMode;
    if (planMode) {
      message = `IMPORTANT: You are in planning mode. Only create a plan - do NOT write any code or make any changes. Just analyze and plan the approach.\n\n${message}`;
    }

    // Initialize permission directory
    const permissionsPath = await this.initializePermissionDirectory(sessionId);
    activeSession.permissionRequestsPath = permissionsPath;
    this.setupPermissionWatcher(sessionId, permissionsPath);

    // Build Claude args with permissions path
    const args = this.buildClaudeArgs(session, config, permissionsPath, sessionId);

    console.log('[CLAUDE ARGS]:', args.join(' '));

    // Create Claude process with permissions directory in env
    const claudeProcess = cp.spawn('claude', args, {
      shell: true,
      cwd: session.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        NODE_NO_READLINE: '1', // Disable readline buffering
        CLAUDE_PERMISSIONS_PATH: permissionsPath, // Claude CLI reads this!
        PERMISSIONS_DIR: permissionsPath, // Pass to MCP server
      },
    });

    activeSession.process = claudeProcess;
    activeSession.rawOutput = '';

    // Disable buffering on stdout and set encoding
    if (claudeProcess.stdout) {
      claudeProcess.stdout.setEncoding('utf8');
      // Resume stream to ensure data flows
      claudeProcess.stdout.resume();
    }

    // Disable buffering on stderr
    if (claudeProcess.stderr) {
      claudeProcess.stderr.setEncoding('utf8');
      claudeProcess.stderr.resume();
    }

    // Handle stdout
    if (claudeProcess.stdout) {
      claudeProcess.stdout.on('data', (data) => {
        // Safety check: ignore if this process is no longer the active one
        if (activeSession.process !== claudeProcess) {
          console.log('[STDOUT] Ignoring data from old process');
          return;
        }

        const chunk = data.toString();
        console.log('[STDOUT CHUNK]:', chunk);
        activeSession.rawOutput += chunk;

        // Process JSON stream line by line
        const lines = activeSession.rawOutput.split('\n');
        activeSession.rawOutput = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              console.log('[PARSING JSON]:', line.trim());
              const jsonData = JSON.parse(line.trim());
              console.log('[PARSED JSON]:', jsonData.type, jsonData.subtype);
              this.processStreamData(sessionId, jsonData);
            } catch (error) {
              console.error('[PARSE ERROR] Failed to parse JSON line:', line, error);
            }
          }
        }
      });
    }

    // Handle stderr - MCP server logs here
    let errorOutput = '';
    if (claudeProcess.stderr) {
      claudeProcess.stderr.on('data', (data) => {
        // Safety check: ignore if this process is no longer the active one
        if (activeSession.process !== claudeProcess) {
          console.log('[STDERR] Ignoring data from old process');
          return;
        }

        const output = data.toString();

        // Log all stderr output
        console.error('[STDERR]:', output);
        errorOutput += output;

        // Forward MCP logs to console for debugging
        if (output.includes('[MCP]')) {
          console.log('[MCP LOG]:', output);
        }
      });
    }

    // Handle process close
    claudeProcess.on('close', (code) => {
      console.log('[PROCESS CLOSE] Code:', code, 'Error output:', errorOutput);

      // Safety check: only update state if this is still the active process
      if (activeSession.process === claudeProcess) {
        session.isProcessing = false;
        activeSession.process = undefined;

        if (code !== 0 && errorOutput.trim()) {
          this.onStreamData(sessionId, {
            type: 'system',
            subtype: 'error',
            message: { content: errorOutput.trim() },
          });
        }
      } else {
        console.log('[PROCESS CLOSE] Ignoring close event from old process');
      }
    });

    // Handle process error
    claudeProcess.on('error', (error) => {
      console.error('Claude process error:', error);

      // Safety check: only update state if this is still the active process
      if (activeSession.process === claudeProcess) {
        session.isProcessing = false;
        activeSession.process = undefined;

        const errorInfo = ErrorHandler.handleStreamError(error);
        this.onStreamData(sessionId, {
          type: 'system',
          subtype: 'error',
          message: {
            content: ErrorHandler.formatError(errorInfo),
          },
        });
      } else {
        console.log('[PROCESS ERROR] Ignoring error event from old process');
      }
    });

    // Send message to Claude's stdin
    if (claudeProcess.stdin) {
      claudeProcess.stdin.write(message + '\n');
      claudeProcess.stdin.end(); // Close to flush output (no interactive permissions without MCP)
    }

    return true;
  }

  /**
   * Stops the Claude process for a session
   */
  stopSession(sessionId: string): boolean {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || !activeSession.process) {
      return false;
    }

    const process = activeSession.process;

    // 1. Remove all event listeners to prevent buffered data from being processed
    if (process.stdout) {
      process.stdout.removeAllListeners('data');
      process.stdout.removeAllListeners('end');
      process.stdout.removeAllListeners('error');
      process.stdout.destroy();
    }

    if (process.stderr) {
      process.stderr.removeAllListeners('data');
      process.stderr.removeAllListeners('end');
      process.stderr.removeAllListeners('error');
      process.stderr.destroy();
    }

    if (process.stdin) {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
    }

    process.removeAllListeners('close');
    process.removeAllListeners('error');
    process.removeAllListeners('exit');

    // 2. Clear any buffered output
    activeSession.rawOutput = '';

    // 3. Use SIGTERM for graceful shutdown
    process.kill('SIGTERM');

    // 4. Fallback to SIGKILL after 1 second if process doesn't exit
    const killTimeout = setTimeout(() => {
      if (process.pid && !process.killed) {
        console.log('[STOP] Process did not exit gracefully, sending SIGKILL');
        process.kill('SIGKILL');
      }
    }, 1000);

    // Clean up timeout when process actually exits
    process.once('exit', () => {
      clearTimeout(killTimeout);
    });

    activeSession.process = undefined;
    activeSession.session.isProcessing = false;

    // Close permission watcher
    if (activeSession.permissionWatcher) {
      activeSession.permissionWatcher.close();
      activeSession.permissionWatcher = undefined;
    }

    // Clear parser state
    if (activeSession.parser) {
      activeSession.parser.clearSession(sessionId);
    }

    // Notify renderer that process was stopped
    this.onStreamData(sessionId, {
      type: 'system',
      subtype: 'stopped',
      message: { content: 'Process stopped by user' },
    });

    return true;
  }

  /**
   * Processes stream data from Claude
   */
  private processStreamData(sessionId: string, jsonData: ClaudeStreamData): void {
    try {
      const activeSession = this.sessions.get(sessionId);
      if (!activeSession || !activeSession.parser) {
        return;
      }

      // Capture session ID for resuming conversations
      if (jsonData.session_id) {
        activeSession.session.claudeSessionId = jsonData.session_id;
        // Notify that session was updated so it can be persisted
        this.onStreamData(sessionId, {
          type: 'system',
          subtype: 'session-updated',
          session: activeSession.session,
        });
      }

      // Parse stream data using MessageParser
      const parsedResults = activeSession.parser.parseStreamData(sessionId, jsonData);

      // Process each parsed result
      for (const result of parsedResults) {
        // Handle session updates
        if (result.sessionUpdate) {
          if (result.sessionUpdate.claudeSessionId) {
            activeSession.session.claudeSessionId = result.sessionUpdate.claudeSessionId;
          }
          if (result.sessionUpdate.isProcessing !== undefined) {
            activeSession.session.isProcessing = result.sessionUpdate.isProcessing;
          }

          // Notify renderer of session update
          this.onStreamData(sessionId, {
            type: 'system',
            subtype: 'session-state-update',
            sessionUpdate: result.sessionUpdate,
          });
        }

        // Handle stats
        if (result.stats) {
          this.onStreamData(sessionId, {
            type: 'system',
            subtype: 'stats',
            stats: result.stats,
          });
        }

        // Handle message creation
        if (result.message) {
          this.onStreamData(sessionId, {
            type: 'system',
            subtype: 'message',
            message: result.message,
          });
        }

        // Handle message updates
        if (result.updates) {
          this.onStreamData(sessionId, {
            type: 'system',
            subtype: 'message-update',
            updates: result.updates,
          });
        }
      }
    } catch (error) {
      const errorInfo = ErrorHandler.handleStreamError(error);
      console.error('[MultiSessionManager] Stream processing error:', ErrorHandler.formatError(errorInfo));

      // Notify renderer of error
      this.onStreamData(sessionId, {
        type: 'system',
        subtype: 'error',
        message: {
          content: ErrorHandler.formatError(errorInfo),
        },
      });
    }
  }


  /**
   * Builds command arguments for Claude CLI
   */
  private buildClaudeArgs(session: Session, config?: SessionConfig, permissionsPath?: string, sessionId?: string): string[] {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];

    // Add model if specified
    const model = config?.model || session.model;
    if (model && model !== 'default') {
      if (model === 'sonnet1m') {
        args.push('--model', 'sonnet[1m]');
      } else {
        args.push('--model', model);
      }
    }

    // Resume session if available
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId);
    }

    // YOLO mode
    if (config?.yoloMode) {
      args.push('--dangerously-skip-permissions');
    } else if (permissionsPath) {
      // Use MCP config for permissions if not in YOLO mode
      const appDir = path.join(__dirname, '../..');
      const mcpConfigPath = config?.mcpConfigPath || path.join(appDir, 'mcp-config.json');

      if (fs.existsSync(mcpConfigPath)) {
        // Read template config
        const templateConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));

        // Replace variables in the config object
        const processedConfig = JSON.parse(
          JSON.stringify(templateConfig)
            .replace(/\{\{APP_DIR\}\}/g, appDir.replace(/\\/g, '\\\\'))
            .replace(/\{\{PERMISSIONS_DIR\}\}/g, permissionsPath.replace(/\\/g, '\\\\'))
        );

        // Write processed config
        const tempConfigPath = path.join(app.getPath('temp'), `mcp-config-${sessionId || 'default'}.json`);
        fs.writeFileSync(tempConfigPath, JSON.stringify(processedConfig, null, 2));

        args.push('--mcp-config', tempConfigPath);
        // Block built-in tools that need permission checking - route through MCP
        args.push('--disallowedTools', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch');
        // Allow MCP permission-wrapped tools + let built-ins handle safe tools
        args.push('--allowedTools',
          'mcp__permissions__Read',
          'mcp__permissions__Write',
          'mcp__permissions__Edit',
          'mcp__permissions__Bash',
          'mcp__permissions__Glob',
          'mcp__permissions__Grep',
          'mcp__permissions__NotebookEdit',
          'mcp__permissions__WebFetch'
        );
        console.log('[MCP] Using config:', tempConfigPath);
        console.log('[MCP] Permissions dir:', permissionsPath);
        console.log('[MCP] Blocking built-in tools, routing through MCP permission wrappers');
      } else {
        console.log('[MCP] Config not found:', mcpConfigPath);
      }
    }

    return args;
  }

  /**
   * Cleanup all sessions
   */
  cleanup(): void {
    for (const [sessionId, activeSession] of this.sessions) {
      if (activeSession.process) {
        activeSession.process.kill('SIGTERM');
      }
      if (activeSession.permissionWatcher) {
        activeSession.permissionWatcher.close();
      }
      if (activeSession.parser) {
        activeSession.parser.clearSession(sessionId);
      }
    }
    this.sessions.clear();
  }
}