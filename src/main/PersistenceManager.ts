import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { Session, Message, AppSettings } from '../shared/types';

interface PersistedSession {
  session: Session;
  messages: Message[];
}

interface ArchivedConversation {
  messages: Message[];
  claudeSessionId?: string;
  timestamp: string;
}

interface PersistedData {
  sessions: PersistedSession[];
  archivedConversations: { [key: string]: ArchivedConversation | Message[] }; // Support old format (Message[]) and new format (ArchivedConversation)
}

export class PersistenceManager {
  private dataDir: string;
  private sessionsFile: string;
  private settingsFile: string;
  private settings: AppSettings | null = null;

  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'sessions');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.settingsFile = path.join(app.getPath('userData'), 'settings.json');
  }

  /**
   * Initializes the persistence directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create persistence directory:', error);
    }
  }

  /**
   * Saves all sessions and their messages
   */
  async saveSessions(sessions: Session[], messagesMap: Map<string, Message[]>, archivedMetadata?: Map<string, { claudeSessionId?: string; timestamp: string }>): Promise<void> {
    try {
      const persistedSessions: PersistedSession[] = sessions.map((session) => ({
        session,
        messages: messagesMap.get(session.id) || [],
      }));

      // Separate archived conversations from session messages
      const archivedConversations: { [key: string]: ArchivedConversation } = {};
      for (const [key, messages] of messagesMap.entries()) {
        // If key doesn't match any session ID, it's an archived conversation
        if (!sessions.find(s => s.id === key)) {
          const metadata = archivedMetadata?.get(key);
          archivedConversations[key] = {
            messages,
            claudeSessionId: metadata?.claudeSessionId,
            timestamp: metadata?.timestamp || key.split('-').pop() || new Date().toISOString()
          };
        }
      }

      const data: PersistedData = {
        sessions: persistedSessions,
        archivedConversations
      };

      await fs.writeFile(
        this.sessionsFile,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save sessions:', error);
    }
  }

  /**
   * Loads all sessions and their messages
   */
  async loadSessions(): Promise<{ sessions: Session[]; messagesMap: Map<string, Message[]>; archivedMetadata: Map<string, { claudeSessionId?: string; timestamp: string }> }> {
    try {
      const fileData = await fs.readFile(this.sessionsFile, 'utf-8');
      const parsed = JSON.parse(fileData);

      // Check if it's the new format with archivedConversations
      let sessions: Session[];
      let messagesMap = new Map<string, Message[]>();
      let archivedMetadata = new Map<string, { claudeSessionId?: string; timestamp: string }>();

      if (Array.isArray(parsed)) {
        // Old format: array of PersistedSession
        const persistedSessions: PersistedSession[] = parsed;
        sessions = persistedSessions.map((ps) => ps.session);
        for (const ps of persistedSessions) {
          messagesMap.set(ps.session.id, ps.messages);
        }
      } else {
        // New format: PersistedData with sessions and archivedConversations
        const data: PersistedData = parsed;
        sessions = data.sessions.map((ps) => ps.session);
        for (const ps of data.sessions) {
          messagesMap.set(ps.session.id, ps.messages);
        }
        // Load archived conversations (supporting both old and new formats)
        for (const [key, value] of Object.entries(data.archivedConversations || {})) {
          if (Array.isArray(value)) {
            // Old format: just an array of messages
            messagesMap.set(key, value);
            archivedMetadata.set(key, { timestamp: key.split('-').pop() || new Date().toISOString() });
          } else {
            // New format: ArchivedConversation with metadata
            messagesMap.set(key, value.messages);
            archivedMetadata.set(key, {
              claudeSessionId: value.claudeSessionId,
              timestamp: value.timestamp
            });
          }
        }
      }

      return { sessions, messagesMap, archivedMetadata };
    } catch (error) {
      // File doesn't exist or is corrupted, return empty state
      return { sessions: [], messagesMap: new Map(), archivedMetadata: new Map() };
    }
  }

  /**
   * Saves a single session
   */
  async saveSession(session: Session, messages: Message[]): Promise<void> {
    try {
      const { sessions, messagesMap, archivedMetadata } = await this.loadSessions();

      // Update or add the session
      const sessionIndex = sessions.findIndex((s) => s.id === session.id);
      if (sessionIndex !== -1) {
        sessions[sessionIndex] = session;
      } else {
        sessions.push(session);
      }

      messagesMap.set(session.id, messages);

      await this.saveSessions(sessions, messagesMap, archivedMetadata);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  /**
   * Deletes a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      const { sessions, messagesMap, archivedMetadata } = await this.loadSessions();

      const filteredSessions = sessions.filter((s) => s.id !== sessionId);
      messagesMap.delete(sessionId);

      await this.saveSessions(filteredSessions, messagesMap, archivedMetadata);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }

  /**
   * Gets messages for a specific session
   */
  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      const { messagesMap } = await this.loadSessions();
      return messagesMap.get(sessionId) || [];
    } catch (error) {
      console.error('Failed to get session messages:', error);
      return [];
    }
  }

  /**
   * Gets all archived conversations for a session's working directory
   */
  async getArchivedConversations(sessionId: string): Promise<Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string}>> {
    try {
      const { sessions, messagesMap } = await this.loadSessions();
      const archived: Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string}> = [];

      // Find the working directory for this session
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        console.log('getArchivedConversations - session not found:', sessionId);
        return [];
      }

      // Normalize path separators to forward slashes
      const workingDirectory = session.workingDirectory.replace(/\\/g, '/');
      console.log('getArchivedConversations - sessionId:', sessionId);
      console.log('getArchivedConversations - workingDirectory:', workingDirectory);
      console.log('getArchivedConversations - messagesMap keys:', Array.from(messagesMap.keys()));

      // Look for archived conversations with format workingDirectory-timestamp
      for (const [key, messages] of messagesMap.entries()) {
        console.log('Checking key:', key, 'starts with:', `${workingDirectory}-`, 'result:', key.startsWith(`${workingDirectory}-`));
        if (key.startsWith(`${workingDirectory}-`) && messages.length > 0) {
          const timestamp = key.substring(workingDirectory.length + 1);
          const firstUserMsg = messages.find(m => m.type === 'user');
          archived.push({
            filename: key,
            timestamp,
            messageCount: messages.length,
            firstMessage: firstUserMsg ? firstUserMsg.content.substring(0, 100) : 'Conversation'
          });
        }
      }

      console.log('getArchivedConversations - found archived:', archived);

      // Sort by timestamp descending (newest first)
      archived.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return archived;
    } catch (error) {
      console.error('Failed to get archived conversations:', error);
      return [];
    }
  }

  /**
   * Gets all archived conversations for a specific working directory
   */
  async getArchivedConversationsForWorkingDir(workingDirectory: string): Promise<Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string}>> {
    try {
      const { messagesMap } = await this.loadSessions();
      const archived: Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string}> = [];

      // Normalize path separators to forward slashes
      const normalizedWorkingDir = workingDirectory.replace(/\\/g, '/');
      console.log('getArchivedConversationsForWorkingDir - workingDirectory:', normalizedWorkingDir);
      console.log('getArchivedConversationsForWorkingDir - messagesMap keys:', Array.from(messagesMap.keys()));

      // Look for archived conversations with format workingDirectory-timestamp
      for (const [key, messages] of messagesMap.entries()) {
        console.log('Checking key:', key, 'starts with:', `${normalizedWorkingDir}-`, 'result:', key.startsWith(`${normalizedWorkingDir}-`));
        if (key.startsWith(`${normalizedWorkingDir}-`) && messages.length > 0) {
          const timestamp = key.substring(normalizedWorkingDir.length + 1);
          const firstUserMsg = messages.find(m => m.type === 'user');
          archived.push({
            filename: key,
            timestamp,
            messageCount: messages.length,
            firstMessage: firstUserMsg ? firstUserMsg.content.substring(0, 100) : 'Conversation'
          });
        }
      }

      console.log('getArchivedConversationsForWorkingDir - found archived:', archived);

      // Sort by timestamp descending (newest first)
      archived.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return archived;
    } catch (error) {
      console.error('Failed to get archived conversations:', error);
      return [];
    }
  }

  /**
   * Loads an archived conversation
   */
  async loadArchivedConversation(filename: string): Promise<Message[]> {
    try {
      const { messagesMap } = await this.loadSessions();
      return messagesMap.get(filename) || [];
    } catch (error) {
      console.error('Failed to load archived conversation:', error);
      return [];
    }
  }

  /**
   * Saves archived messages with claudeSessionId
   */
  async saveArchivedMessages(key: string, messages: Message[], claudeSessionId?: string): Promise<void> {
    try {
      const { sessions, messagesMap, archivedMetadata } = await this.loadSessions();
      messagesMap.set(key, messages);

      // Store metadata including claudeSessionId
      archivedMetadata.set(key, {
        claudeSessionId,
        timestamp: key.split('-').pop() || new Date().toISOString()
      });

      await this.saveSessions(sessions, messagesMap, archivedMetadata);
    } catch (error) {
      console.error('Failed to save archived messages:', error);
    }
  }

  /**
   * Gets the claudeSessionId for an archived conversation
   */
  async getArchivedClaudeSessionId(filename: string): Promise<string | undefined> {
    try {
      const { archivedMetadata } = await this.loadSessions();
      return archivedMetadata.get(filename)?.claudeSessionId;
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