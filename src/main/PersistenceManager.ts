import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Session, Message, AppSettings } from '../shared/types';

interface ArchivedConversation {
  messages: Message[];
  claudeSessionId?: string;
  timestamp: string;
}

export class PersistenceManager {
  private sessionsDir: string;
  private settingsFile: string;
  private settings: AppSettings | null = null;

  constructor() {
    this.sessionsDir = path.join(app.getPath('userData'), 'sessions');
    this.settingsFile = path.join(app.getPath('userData'), 'settings.json');
  }

  /**
   * Initializes the persistence directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create persistence directory:', error);
    }
  }

  /**
   * Gets the folder path for a session based on its name
   */
  private getSessionFolderPath(sessionName: string): string {
    // Sanitize session name for use as folder name
    const sanitizedName = sessionName.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(this.sessionsDir, sanitizedName);
  }

  /**
   * Gets the session.json file path for a session
   */
  private getSessionFilePath(sessionName: string): string {
    return path.join(this.getSessionFolderPath(sessionName), 'session.json');
  }

  /**
   * Gets the messages.json file path for a session
   */
  private getMessagesFilePath(sessionName: string): string {
    return path.join(this.getSessionFolderPath(sessionName), 'messages.json');
  }

  /**
   * Gets the history folder path for a session
   */
  private getHistoryFolderPath(sessionName: string): string {
    return path.join(this.getSessionFolderPath(sessionName), 'history');
  }

  /**
   * Loads all sessions from their individual folders
   */
  async loadSessions(): Promise<{ sessions: Session[]; messagesMap: Map<string, Message[]>; archivedMetadata: Map<string, { claudeSessionId?: string; timestamp: string }> }> {
    try {
      const sessions: Session[] = [];
      const messagesMap = new Map<string, Message[]>();
      const archivedMetadata = new Map<string, { claudeSessionId?: string; timestamp: string }>();

      // Read all session folders
      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionFolderPath = path.join(this.sessionsDir, entry.name);
        const sessionFilePath = path.join(sessionFolderPath, 'session.json');
        const messagesFilePath = path.join(sessionFolderPath, 'messages.json');
        const historyFolderPath = path.join(sessionFolderPath, 'history');

        // Load session metadata
        try {
          const sessionData = await fs.readFile(sessionFilePath, 'utf-8');
          const session: Session = JSON.parse(sessionData);
          sessions.push(session);

          // Load current messages
          try {
            const messagesData = await fs.readFile(messagesFilePath, 'utf-8');
            const messages: Message[] = JSON.parse(messagesData);
            messagesMap.set(session.id, messages);
          } catch {
            // No messages file yet, use empty array
            messagesMap.set(session.id, []);
          }

          // Load archived conversations from history folder
          try {
            const historyEntries = await fs.readdir(historyFolderPath);

            for (const historyFile of historyEntries) {
              if (!historyFile.endsWith('.json')) continue;

              const historyFilePath = path.join(historyFolderPath, historyFile);
              const archivedData = await fs.readFile(historyFilePath, 'utf-8');
              const archived: ArchivedConversation = JSON.parse(archivedData);

              // Use the session's working directory + timestamp as the key
              const timestamp = historyFile.replace('.json', '');
              const normalizedPath = session.workingDirectory.replace(/\\/g, '/');
              const archiveKey = `${normalizedPath}-${timestamp}`;

              messagesMap.set(archiveKey, archived.messages);
              archivedMetadata.set(archiveKey, {
                claudeSessionId: archived.claudeSessionId,
                timestamp: archived.timestamp || timestamp
              });
            }
          } catch {
            // No history folder yet
          }
        } catch (error) {
          console.error(`Failed to load session from ${entry.name}:`, error);
        }
      }

      return { sessions, messagesMap, archivedMetadata };
    } catch (error) {
      // Directory doesn't exist yet
      return { sessions: [], messagesMap: new Map(), archivedMetadata: new Map() };
    }
  }

  /**
   * Saves a single session and its messages
   */
  async saveSession(session: Session, messages: Message[]): Promise<void> {
    try {
      const sessionFolderPath = this.getSessionFolderPath(session.name);
      const sessionFilePath = this.getSessionFilePath(session.name);
      const messagesFilePath = this.getMessagesFilePath(session.name);

      // Create session folder if it doesn't exist
      await fs.mkdir(sessionFolderPath, { recursive: true });

      // Save session metadata
      await fs.writeFile(sessionFilePath, JSON.stringify(session, null, 2), 'utf-8');

      // Save current messages
      await fs.writeFile(messagesFilePath, JSON.stringify(messages, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  /**
   * Deletes a session and all its data
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      // Find the session to get its name
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        console.error('Session not found:', sessionId);
        return;
      }

      const sessionFolderPath = this.getSessionFolderPath(session.name);

      // Delete the entire session folder
      await fs.rm(sessionFolderPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }

  /**
   * Gets messages for a specific session
   */
  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      // Find the session to get its name
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        return [];
      }

      const messagesFilePath = this.getMessagesFilePath(session.name);

      try {
        const messagesData = await fs.readFile(messagesFilePath, 'utf-8');
        return JSON.parse(messagesData);
      } catch {
        return [];
      }
    } catch (error) {
      console.error('Failed to get session messages:', error);
      return [];
    }
  }

  /**
   * Saves the current active conversation to history/current.json
   */
  async saveCurrentConversation(sessionId: string, messages: Message[], claudeSessionId?: string): Promise<void> {
    try {
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        console.error('[PersistenceManager] Session not found for saveCurrentConversation:', sessionId);
        return;
      }

      const historyFolderPath = this.getHistoryFolderPath(session.name);
      await fs.mkdir(historyFolderPath, { recursive: true });

      const currentFilePath = path.join(historyFolderPath, 'current.json');

      // Check if current.json already exists to preserve original timestamp
      let timestamp = new Date().toISOString();
      try {
        const existingData = await fs.readFile(currentFilePath, 'utf-8');
        const existing: ArchivedConversation = JSON.parse(existingData);
        // Preserve the original timestamp
        timestamp = existing.timestamp;
      } catch {
        // File doesn't exist yet, use new timestamp
      }

      const currentConversation: ArchivedConversation = {
        messages,
        claudeSessionId,
        timestamp
      };

      await fs.writeFile(currentFilePath, JSON.stringify(currentConversation, null, 2), 'utf-8');

      console.log('[PersistenceManager] Current conversation saved to:', currentFilePath);
    } catch (error) {
      console.error('[PersistenceManager] Failed to save current conversation:', error);
    }
  }

  /**
   * Gets all archived conversations for a specific working directory
   */
  async getArchivedConversationsForWorkingDir(workingDirectory: string): Promise<Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string, isCurrent?: boolean}>> {
    try {
      const { sessions } = await this.loadSessions();
      const archived: Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string, isCurrent?: boolean}> = [];

      // Normalize paths for comparison (both to forward slashes)
      const normalizedWorkingDir = workingDirectory.replace(/\\/g, '/');

      // Find the session with this working directory
      const session = sessions.find(s => s.workingDirectory.replace(/\\/g, '/') === normalizedWorkingDir);

      if (!session) {
        console.log('getArchivedConversationsForWorkingDir - no session found for:', workingDirectory);
        return [];
      }

      const historyFolderPath = this.getHistoryFolderPath(session.name);

      try {
        const historyEntries = await fs.readdir(historyFolderPath);

        for (const historyFile of historyEntries) {
          if (!historyFile.endsWith('.json')) continue;

          const historyFilePath = path.join(historyFolderPath, historyFile);
          const archivedData = await fs.readFile(historyFilePath, 'utf-8');
          const archivedConv: ArchivedConversation = JSON.parse(archivedData);

          // Check if this is the current conversation
          const isCurrent = historyFile === 'current.json';

          let archiveKey: string;
          let timestamp: string;

          if (isCurrent) {
            // Special handling for current conversation
            archiveKey = `${session.id}-current`;
            timestamp = archivedConv.timestamp;
          } else {
            // Regular archived conversation
            timestamp = historyFile.replace('.json', '');
            const normalizedPath = session.workingDirectory.replace(/\\/g, '/');
            archiveKey = `${normalizedPath}-${timestamp}`;
          }

          const firstUserMsg = archivedConv.messages.find(m => m.type === 'user');
          archived.push({
            filename: archiveKey,
            timestamp: archivedConv.timestamp || timestamp,
            messageCount: archivedConv.messages.length,
            firstMessage: firstUserMsg ? firstUserMsg.content.substring(0, 100) : 'Conversation',
            isCurrent
          });
        }

        // Sort by isCurrent first (current conversation at top), then by timestamp descending
        archived.sort((a, b) => {
          if (a.isCurrent && !b.isCurrent) return -1;
          if (!a.isCurrent && b.isCurrent) return 1;
          return b.timestamp.localeCompare(a.timestamp);
        });
      } catch {
        // No history folder yet
      }

      return archived;
    } catch (error) {
      console.error('Failed to get archived conversations:', error);
      return [];
    }
  }

  /**
   * Loads an archived conversation by its archive key
   */
  async loadArchivedConversation(archiveKey: string): Promise<Message[]> {
    try {
      // Check if this is the current conversation
      if (archiveKey.endsWith('-current')) {
        const sessionId = archiveKey.replace('-current', '');
        const { sessions } = await this.loadSessions();
        const session = sessions.find(s => s.id === sessionId);

        if (!session) {
          console.error('Session not found for current conversation:', sessionId);
          return [];
        }

        const currentFilePath = path.join(this.getHistoryFolderPath(session.name), 'current.json');
        const archivedData = await fs.readFile(currentFilePath, 'utf-8');
        const archived: ArchivedConversation = JSON.parse(archivedData);

        return archived.messages;
      }

      // Parse the archive key to extract working directory and timestamp
      // Format: workingDirectory-YYYY-MM-DDTHH-MM-SS.sssZ
      const timestampMatch = archiveKey.match(/-(\d{4}-\d{2}-\d{2}T[\d\-\.]+Z)$/);
      if (!timestampMatch) {
        return [];
      }

      const timestamp = timestampMatch[1];
      const workingDirectory = archiveKey.substring(0, archiveKey.length - timestamp.length - 1);

      // Find the session with this working directory
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.workingDirectory.replace(/\\/g, '/') === workingDirectory);

      if (!session) {
        console.error('Session not found for working directory:', workingDirectory);
        return [];
      }

      const historyFilePath = path.join(this.getHistoryFolderPath(session.name), `${timestamp}.json`);

      const archivedData = await fs.readFile(historyFilePath, 'utf-8');
      const archived: ArchivedConversation = JSON.parse(archivedData);

      return archived.messages;
    } catch (error) {
      console.error('Failed to load archived conversation:', error);
      return [];
    }
  }

  /**
   * Saves archived messages with claudeSessionId to the session's history folder
   */
  async saveArchivedMessages(archiveKey: string, messages: Message[], claudeSessionId?: string): Promise<void> {
    try {
      console.log('[PersistenceManager] saveArchivedMessages - archiveKey:', archiveKey);
      console.log('[PersistenceManager] saveArchivedMessages - message count:', messages.length);
      console.log('[PersistenceManager] saveArchivedMessages - claudeSessionId:', claudeSessionId);

      // Parse the archive key to extract working directory and timestamp
      // Format: workingDirectory-YYYY-MM-DDTHH-MM-SS.sssZ
      // Look for the pattern -YYYY-MM-DD to find where the timestamp starts
      const timestampMatch = archiveKey.match(/-(\d{4}-\d{2}-\d{2}T[\d\-\.]+Z)$/);
      if (!timestampMatch) {
        console.error('[PersistenceManager] Invalid archive key format:', archiveKey);
        return;
      }

      const timestamp = timestampMatch[1];
      const workingDirectory = archiveKey.substring(0, archiveKey.length - timestamp.length - 1);

      console.log('[PersistenceManager] workingDirectory:', workingDirectory);
      console.log('[PersistenceManager] timestamp:', timestamp);

      // Find the session with this working directory
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.workingDirectory.replace(/\\/g, '/') === workingDirectory);

      if (!session) {
        console.error('[PersistenceManager] Session not found for working directory:', workingDirectory);
        console.error('[PersistenceManager] Available sessions:', sessions.map(s => ({ id: s.id, name: s.name, workingDirectory: s.workingDirectory })));
        return;
      }

      console.log('[PersistenceManager] Found session:', session.name);

      const historyFolderPath = this.getHistoryFolderPath(session.name);
      console.log('[PersistenceManager] historyFolderPath:', historyFolderPath);

      // Create history folder if it doesn't exist
      await fs.mkdir(historyFolderPath, { recursive: true });

      const archivedConversation: ArchivedConversation = {
        messages,
        claudeSessionId,
        timestamp
      };

      const historyFilePath = path.join(historyFolderPath, `${timestamp}.json`);
      console.log('[PersistenceManager] Writing to:', historyFilePath);

      await fs.writeFile(historyFilePath, JSON.stringify(archivedConversation, null, 2), 'utf-8');
      console.log('[PersistenceManager] Archive saved successfully!');
    } catch (error) {
      console.error('[PersistenceManager] Failed to save archived messages:', error);
    }
  }

  /**
   * Gets the claudeSessionId for an archived conversation
   */
  async getArchivedClaudeSessionId(archiveKey: string): Promise<string | undefined> {
    try {
      // Check if this is the current conversation
      if (archiveKey.endsWith('-current')) {
        const sessionId = archiveKey.replace('-current', '');
        const { sessions } = await this.loadSessions();
        const session = sessions.find(s => s.id === sessionId);

        if (!session) {
          return undefined;
        }

        const currentFilePath = path.join(this.getHistoryFolderPath(session.name), 'current.json');
        const archivedData = await fs.readFile(currentFilePath, 'utf-8');
        const archived: ArchivedConversation = JSON.parse(archivedData);

        return archived.claudeSessionId;
      }

      // Parse the archive key to extract working directory and timestamp
      // Format: workingDirectory-YYYY-MM-DDTHH-MM-SS.sssZ
      const timestampMatch = archiveKey.match(/-(\d{4}-\d{2}-\d{2}T[\d\-\.]+Z)$/);
      if (!timestampMatch) {
        return undefined;
      }

      const timestamp = timestampMatch[1];
      const workingDirectory = archiveKey.substring(0, archiveKey.length - timestamp.length - 1);

      // Find the session with this working directory
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.workingDirectory.replace(/\\/g, '/') === workingDirectory);

      if (!session) {
        return undefined;
      }

      const historyFilePath = path.join(this.getHistoryFolderPath(session.name), `${timestamp}.json`);

      const archivedData = await fs.readFile(historyFilePath, 'utf-8');
      const archived: ArchivedConversation = JSON.parse(archivedData);

      return archived.claudeSessionId;
    } catch (error) {
      console.error('Failed to get archived claudeSessionId:', error);
      return undefined;
    }
  }

  /**
   * Gets application settings
   */
  async getSettings(): Promise<AppSettings> {
    if (this.settings) {
      return this.settings;
    }

    try {
      const data = await fs.readFile(this.settingsFile, 'utf-8');
      this.settings = JSON.parse(data);
      return this.settings!;
    } catch (error) {
      // Return default settings if file doesn't exist
      this.settings = {
        theme: 'dark',
        defaultModel: 'default',
        alwaysAllowPermissions: [],
      };
      return this.settings;
    }
  }

  /**
   * Updates application settings
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    try {
      const currentSettings = await this.getSettings();
      this.settings = { ...currentSettings, ...updates };
      await fs.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  }
}