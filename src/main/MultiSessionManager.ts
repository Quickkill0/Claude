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
    private onPermissionRequest?: (sessionId: string, tool: string, path: string, message: string, input?: any) => Promise<{ allowed: boolean; alwaysAllow?: boolean }>
  ) {}

  /**
   * Note: Permission handling is now done via PreToolUse hooks
   * See .claude/hooks/permission-proxy.py for the hook implementation
   * Permissions are handled by the PermissionServer HTTP server
   */

  /**
   * Sets up PreToolUse hooks for permission handling in the session's working directory
   * Writes hooks to settings.gui.json (GUI-only) to avoid interfering with CLI usage
   */
  private async setupPermissionHooks(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    const workingDir = activeSession.session.workingDirectory;
    const claudeDir = path.join(workingDir, '.claude');
    const hooksDir = path.join(claudeDir, 'hooks');
    const guiSettingsFile = path.join(claudeDir, 'settings.gui.json');

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

    // Read existing GUI settings or create new
    let guiSettings: any = {};
    if (fs.existsSync(guiSettingsFile)) {
      try {
        guiSettings = JSON.parse(fs.readFileSync(guiSettingsFile, 'utf8'));
        console.log('[HOOKS] Found existing settings.gui.json, preserving existing configuration');
      } catch (error) {
        console.error('[HOOKS] Error reading settings.gui.json:', error);
        guiSettings = {};
      }
    }

    // Configure PreToolUse hook for GUI
    if (!guiSettings.hooks) {
      guiSettings.hooks = {};
    }

    // Add/update only the PreToolUse hook, preserving any other hooks
    guiSettings.hooks.PreToolUse = [{
      matcher: "*",
      hooks: [{
        type: "command",
        command: "python .claude/hooks/permission-proxy.py",
        timeout: 300
      }]
    }];

    // Write GUI settings (hooks only, permissions stay in settings.local.json)
    fs.writeFileSync(guiSettingsFile, JSON.stringify(guiSettings, null, 2));
    console.log('[HOOKS] Configured PreToolUse hooks in:', guiSettingsFile);
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

    // Save to settings.local.json for actual permission enforcement
    const workingDir = activeSession.session.workingDirectory;
    const settingsFile = path.join(workingDir, '.claude', 'settings.local.json');

    // Format permission string based on tool type
    let permissionString = '';
    let displayPath = filePath; // Path to display in UI

    if (tool === 'Bash') {
      // For bash commands, extract the command from the input
      // Format: Bash(command:*)
      const command = input?.command?.split(' ')[0] || '';
      permissionString = `Bash(${command}:*)`;
      displayPath = command; // Show just the command in UI
    } else if (filePath === '*' || filePath === '') {
      // Allow all for this tool
      permissionString = `${tool}(*)`;
      displayPath = '*';
    } else {
      // For file operations, save the working directory pattern instead of specific file
      // This allows the user to approve once for the entire working directory
      const fileTools = ['Read', 'Write', 'Edit', 'NotebookEdit'];
      if (fileTools.includes(tool)) {
        // Use the working directory with recursive wildcard pattern
        // Format: Tool(E:\Path\To\Dir\**)
        permissionString = `${tool}(${workingDir}/**)`;
        displayPath = `${workingDir}/**`; // Show the pattern in UI
      } else {
        // Other tools (Glob, Grep, WebFetch, etc.) use the specific path
        permissionString = `${tool}(${filePath})`;
        displayPath = filePath;
      }
    }

    // Update session object's sessionPermissions array for UI display
    // Use the formatted display path that matches what we save
    if (!activeSession.session.sessionPermissions) {
      activeSession.session.sessionPermissions = [];
    }

    // Check if permission already exists in session object
    const exists = activeSession.session.sessionPermissions.some(
      p => p.tool === tool && p.path === displayPath
    );

    if (!exists) {
      activeSession.session.sessionPermissions.push({
        tool,
        path: displayPath,
        allowed: true,
        createdAt: new Date().toISOString(),
      });
    }

    try {
      // Read existing settings
      let settings: any = {};
      if (fs.existsSync(settingsFile)) {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      }

      // Initialize permissions structure if it doesn't exist
      if (!settings.permissions) {
        settings.permissions = { allow: [], deny: [] };
      }
      if (!settings.permissions.allow) {
        settings.permissions.allow = [];
      }

      // Check if permission already exists in settings
      const settingsExists = settings.permissions.allow.includes(permissionString);

      if (!settingsExists) {
        settings.permissions.allow.push(permissionString);

        // Write settings back
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        console.log(`[PERMISSIONS] Saved to settings.local.json: ${permissionString}`);
      }

    } catch (error) {
      console.error('[PERMISSIONS] Error saving to settings.local.json:', error);
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

    // Remove from settings.local.json
    const workingDir = activeSession.session.workingDirectory;
    const settingsFile = path.join(workingDir, '.claude', 'settings.local.json');

    try {
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

        if (settings.permissions && settings.permissions.allow) {
          // Format permission string to match what we saved
          let permissionString = '';

          if (permission.tool === 'Bash') {
            // For bash, we need to reconstruct the command pattern
            // This is best-effort since we don't store the original input
            const pathParts = (permission.path || '').split(' ');
            const command = pathParts[0] || '';
            permissionString = `Bash(${command}:*)`;
          } else if (!permission.path || permission.path === '*' || permission.path === '') {
            permissionString = `${permission.tool}(*)`;
          } else {
            permissionString = `${permission.tool}(${permission.path})`;
          }

          // Remove the permission from allow array
          const allowIndex = settings.permissions.allow.indexOf(permissionString);
          if (allowIndex !== -1) {
            settings.permissions.allow.splice(allowIndex, 1);
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
            console.log(`[PERMISSIONS] Removed from settings.local.json: ${permissionString}`);
          }
        }
      }
    } catch (error) {
      console.error('[PERMISSIONS] Error removing from settings.local.json:', error);
    }

    // Remove from session object
    activeSession.session.sessionPermissions.splice(index, 1);

    console.log(`[PERMISSIONS] Removed permission for ${permission.tool}`);
  }

  /**
   * Loads permissions into session object from settings.local.json
   * With PreToolUse hooks, permissions are defined in settings.local.json
   */
  async loadSessionPermissions(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    // Initialize empty permissions array
    if (!activeSession.session.sessionPermissions) {
      activeSession.session.sessionPermissions = [];
    }

    // Load permissions from settings.local.json
    const workingDir = activeSession.session.workingDirectory;
    const settingsFile = path.join(workingDir, '.claude', 'settings.local.json');

    try {
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

        if (settings.permissions && settings.permissions.allow) {
          // Parse permission strings and add to session object
          for (const permString of settings.permissions.allow) {
            // Parse format: Tool(path) or Bash(command:*)
            const match = permString.match(/^([^(]+)\(([^)]+)\)$/);
            if (match) {
              const tool = match[1];
              let path = match[2];

              // For Bash commands, extract just the command part
              if (tool === 'Bash' && path.includes(':')) {
                path = path.split(':')[0];
              }

              // Check if already exists (avoid duplicates)
              const exists = activeSession.session.sessionPermissions.some(
                p => p.tool === tool && p.path === path
              );

              if (!exists) {
                activeSession.session.sessionPermissions.push({
                  tool,
                  path,
                  allowed: true,
                  createdAt: new Date().toISOString(),
                });
              }
            }
          }

          console.log(`[PERMISSIONS] Loaded ${activeSession.session.sessionPermissions.length} permissions for session ${sessionId}`);
        }
      }
    } catch (error) {
      console.error('[PERMISSIONS] Error loading from settings.local.json:', error);
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

    // Add GUI-specific settings file for hooks
    // This allows CLI users to use the same folder without hook interference
    args.push('--settings', '.claude/settings.gui.json');

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