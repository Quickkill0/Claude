import * as cp from 'child_process';
import { Session, SessionConfig, ClaudeStreamData } from '../shared/types';
import * as crypto from 'crypto';

interface ActiveSession {
  session: Session;
  process?: cp.ChildProcess;
  rawOutput: string;
}

export class MultiSessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(
    private onStreamData: (sessionId: string, data: ClaudeStreamData) => void,
    private onPermissionRequest?: (sessionId: string, tool: string, path: string, message: string) => Promise<boolean>
  ) {}

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

    // Build Claude args
    const args = this.buildClaudeArgs(session, config);

    // Create Claude process
    const claudeProcess = cp.spawn('claude', args, {
      shell: process.platform === 'win32',
      cwd: session.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    activeSession.process = claudeProcess;
    activeSession.rawOutput = '';

    // Handle stdout
    if (claudeProcess.stdout) {
      claudeProcess.stdout.on('data', (data) => {
        activeSession.rawOutput += data.toString();

        // Process JSON stream line by line
        const lines = activeSession.rawOutput.split('\n');
        activeSession.rawOutput = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const jsonData = JSON.parse(line.trim());
              this.processStreamData(sessionId, jsonData);
            } catch (error) {
              console.error('Failed to parse JSON line:', line, error);
            }
          }
        }
      });
    }

    // Handle stderr
    let errorOutput = '';
    if (claudeProcess.stderr) {
      claudeProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        errorOutput += output;

        // Check for permission request pattern
        // Pattern: "Claude requested permissions to <action> to <path>, but you haven't granted it yet."
        const permissionMatch = output.match(/Claude requested permissions? to (\w+)(?: to)? (.+?), but you haven't granted it yet/);
        if (permissionMatch && this.onPermissionRequest) {
          const tool = permissionMatch[1]; // e.g., "write"
          const filePath = permissionMatch[2]; // e.g., "E:\Development\testGame\pong.html"
          const message = `Claude is requesting permission to ${tool} ${filePath}`;

          console.log('Permission request detected:', { tool, filePath, message });

          // Request permission
          const allowed = await this.onPermissionRequest(sessionId, tool, filePath, message);

          if (allowed) {
            console.log('Permission granted, sending approval to Claude');
            // Send approval via stdin (Claude CLI should be waiting for response)
            if (claudeProcess.stdin && !claudeProcess.stdin.destroyed) {
              const written = claudeProcess.stdin.write('y\n');
              console.log('Wrote "y" to stdin:', written);
            } else {
              console.log('Cannot write to stdin - stdin is', claudeProcess.stdin ? 'destroyed' : 'null');
            }
          } else {
            console.log('Permission denied, sending denial to Claude');
            // Send denial via stdin
            if (claudeProcess.stdin && !claudeProcess.stdin.destroyed) {
              const written = claudeProcess.stdin.write('n\n');
              console.log('Wrote "n" to stdin:', written);
            } else {
              console.log('Cannot write to stdin - stdin is', claudeProcess.stdin ? 'destroyed' : 'null');
            }
          }
        }
      });
    }

    // Handle process close
    claudeProcess.on('close', (code) => {
      console.log(`Claude process closed with code: ${code}`);
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
    // Note: Don't call stdin.end() here - we need to keep stdin open for permission responses
    if (claudeProcess.stdin) {
      claudeProcess.stdin.write(message + '\n');
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

    // Forward to renderer
    this.onStreamData(sessionId, jsonData);
  }

  /**
   * Builds command arguments for Claude CLI
   */
  private buildClaudeArgs(session: Session, config?: SessionConfig): string[] {
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
    }

    // MCP config
    if (config?.mcpConfigPath) {
      args.push('--mcp-config', config.mcpConfigPath);
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
    }
    this.sessions.clear();
  }
}