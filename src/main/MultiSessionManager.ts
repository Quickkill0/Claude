import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Session, SessionConfig, ClaudeStreamData } from '../shared/types';
import * as crypto from 'crypto';
import { app } from 'electron';

interface ActiveSession {
  session: Session;
  process?: cp.ChildProcess;
  rawOutput: string;
  permissionRequestsPath?: string;
  permissionWatcher?: fs.FSWatcher;
  processingRequests?: Set<string>;
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

      // Small delay to ensure file is fully written
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
            // Ask for permission
            const allowed = await this.onPermissionRequest(
              sessionId,
              request.tool || 'unknown',
              request.input?.command || request.input?.file_path || 'unknown',
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
          console.error('[PERMISSIONS] Error handling request:', error);
        } finally {
          // Remove from processing set
          activeSession.processingRequests?.delete(filename);
        }
      }, 100);
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
    };

    this.sessions.set(sessionId, {
      session,
      rawOutput: '',
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

    const session = activeSession.session;
    session.isProcessing = true;
    session.lastActive = new Date().toISOString();

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
      session.isProcessing = false;
      activeSession.process = undefined;

      if (code !== 0 && errorOutput.trim()) {
        this.onStreamData(sessionId, {
          type: 'system',
          subtype: 'error',
          message: { content: errorOutput.trim() },
        });
      }
    });

    // Handle process error
    claudeProcess.on('error', (error) => {
      console.error('Claude process error:', error);
      session.isProcessing = false;
      activeSession.process = undefined;

      this.onStreamData(sessionId, {
        type: 'system',
        subtype: 'error',
        message: {
          content: error.message.includes('ENOENT')
            ? 'Claude CLI not found. Please install Claude Code first.'
            : `Error: ${error.message}`,
        },
      });
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

    activeSession.process.kill('SIGKILL');
    activeSession.process = undefined;
    activeSession.session.isProcessing = false;

    // Close permission watcher
    if (activeSession.permissionWatcher) {
      activeSession.permissionWatcher.close();
      activeSession.permissionWatcher = undefined;
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
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {return;}

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

    // Process different message types
    switch (jsonData.type) {
      case 'system':
        this.handleSystemMessage(sessionId, jsonData);
        break;
      case 'assistant':
        this.handleAssistantMessage(sessionId, jsonData);
        break;
      case 'user':
        this.handleUserMessage(sessionId, jsonData);
        break;
      case 'result':
        this.handleResultMessage(sessionId, jsonData);
        break;
      default:
        // Forward unknown types as-is
        this.onStreamData(sessionId, jsonData);
    }
  }

  /**
   * Handles system messages
   */
  private handleSystemMessage(sessionId: string, jsonData: ClaudeStreamData): void {
    if (jsonData.subtype === 'init') {
      // Session initialized
      this.onStreamData(sessionId, jsonData);
    } else {
      // Other system messages
      this.onStreamData(sessionId, jsonData);
    }
  }

  /**
   * Handles assistant messages (content, tool use, thinking)
   */
  private handleAssistantMessage(sessionId: string, jsonData: ClaudeStreamData): void {
    // Just forward the original data - let renderer handle formatting
    this.onStreamData(sessionId, jsonData);
  }

  /**
   * Handles user messages (tool results)
   */
  private handleUserMessage(sessionId: string, jsonData: ClaudeStreamData): void {
    // Just forward the original data - let renderer handle formatting
    this.onStreamData(sessionId, jsonData);
  }

  /**
   * Handles result messages (final response)
   */
  private handleResultMessage(sessionId: string, jsonData: ClaudeStreamData): void {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    if (jsonData.subtype === 'success') {
      // Request completed
      activeSession.session.isProcessing = false;
    }

    // Forward the original data - let renderer handle formatting
    this.onStreamData(sessionId, jsonData);
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
        args.push('--allowedTools', 'mcp__permissions__approval_prompt');
        args.push('--permission-prompt-tool', 'mcp__permissions__approval_prompt');
        console.log('[MCP] Using config:', tempConfigPath);
        console.log('[MCP] Permissions dir:', permissionsPath);
        console.log('[MCP] Using approval_prompt tool for permissions');
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
    for (const [_, activeSession] of this.sessions) {
      if (activeSession.process) {
        activeSession.process.kill('SIGTERM');
      }
      if (activeSession.permissionWatcher) {
        activeSession.permissionWatcher.close();
      }
    }
    this.sessions.clear();
  }
}