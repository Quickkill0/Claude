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
  parser?: MessageParser;
}

export class MultiSessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(
    private onStreamData: (sessionId: string, data: ClaudeStreamData) => void,
    private onPermissionRequest?: (sessionId: string, tool: string, path: string, message: string) => Promise<{ allowed: boolean; alwaysAllow?: boolean }>
  ) {}

  /**
   * Note: Permission handling is now done via PreToolUse hooks
   * See .claude/hooks/permission-proxy.py for the hook implementation
   * Permissions are handled by the PermissionServer HTTP server
   */

  /**
   * Sets up PreToolUse hooks for permission handling in the session's working directory
   */
  private async setupPermissionHooks(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    const workingDir = activeSession.session.workingDirectory;
    const claudeDir = path.join(workingDir, '.claude');
    const hooksDir = path.join(claudeDir, 'hooks');
    const settingsFile = path.join(claudeDir, 'settings.local.json');

    // Create directories if they don't exist
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // Copy permission-proxy.py to session's hooks directory
    const appHooksDir = path.join(__dirname, '../../.claude/hooks');
    const proxyScriptSource = path.join(appHooksDir, 'permission-proxy.py');
    const proxyScriptDest = path.join(hooksDir, 'permission-proxy.py');

    if (fs.existsSync(proxyScriptSource)) {
      fs.copyFileSync(proxyScriptSource, proxyScriptDest);
      console.log('[HOOKS] Copied permission-proxy.py to:', proxyScriptDest);
    }

    // Read existing settings or create new
    let settings: any = {};
    if (fs.existsSync(settingsFile)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      } catch (error) {
        console.error('[HOOKS] Error reading settings.local.json:', error);
      }
    }

    // Add PreToolUse hook configuration
    settings.hooks = {
      PreToolUse: [{
        matcher: "*",
        hooks: [{
          type: "command",
          command: "python .claude/hooks/permission-proxy.py",
          timeout: 300
        }]
      }]
    };

    // Write settings back
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    console.log('[HOOKS] Configured PreToolUse hooks in:', settingsFile);
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

    // Set up permission hooks for this session
    await this.setupPermissionHooks(sessionId);

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
   * With PreToolUse hooks, permissions are checked in settings.local.json
   */
  async savePermissionForSession(sessionId: string, tool: string, filePath: string, input?: any): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    // Update session object's sessionPermissions array for UI display
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

    console.log(`[PERMISSIONS] Saved permission for ${tool}: ${filePath}`);
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

    console.log(`[PERMISSIONS] Removed permission for ${permission.tool}`);
  }

  /**
   * Loads permissions into session object (placeholder for now)
   * With PreToolUse hooks, permissions are defined in settings.local.json
   */
  async loadSessionPermissions(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    // Initialize empty permissions array
    // Permissions are now managed through settings.local.json
    if (!activeSession.session.sessionPermissions) {
      activeSession.session.sessionPermissions = [];
    }

    console.log(`[PERMISSIONS] Initialized permissions for session ${sessionId}`);
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

    // Set up permission hooks for this session
    await this.setupPermissionHooks(sessionId);

    // Build Claude args
    const args = this.buildClaudeArgs(session, config, undefined, sessionId);

    console.log('[CLAUDE ARGS]:', args.join(' '));

    // Create Claude process
    // Permissions are handled by PreToolUse hooks via .claude/hooks/permission-proxy.py
    const claudeProcess = cp.spawn('claude', args, {
      shell: true,
      cwd: session.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        NODE_NO_READLINE: '1', // Disable readline buffering
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

    // YOLO mode (skip all permissions)
    if (config?.yoloMode) {
      args.push('--dangerously-skip-permissions');
    }
    // With PreToolUse hooks, permissions are handled by .claude/hooks/permission-proxy.py
    // No need for MCP config - hooks intercept tool calls automatically

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
      if (activeSession.parser) {
        activeSession.parser.clearSession(sessionId);
      }
    }
    this.sessions.clear();
  }
}