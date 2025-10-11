import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Session, Message, AppSettings } from '../shared/types';

interface ArchivedConversation {
  messages: Message[];
  claudeSessionId?: string;
  timestamp: string;
  totalCost?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
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

      // Save current messages (ensure it's always an array)
      const safeMessages = Array.isArray(messages) ? messages : [];
      await fs.writeFile(messagesFilePath, JSON.stringify(safeMessages, null, 2), 'utf-8');
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
   * Saves a conversation to history/{conversationId}.json
   */
  async saveConversation(sessionId: string, conversationId: string, messages: Message[], claudeSessionId?: string): Promise<void> {
    try {
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        console.error('[PersistenceManager] Session not found:', sessionId);
        return;
      }

      const historyFolderPath = this.getHistoryFolderPath(session.name);
      await fs.mkdir(historyFolderPath, { recursive: true });

      const conversationFilePath = path.join(historyFolderPath, `${conversationId}.json`);

      // Preserve original timestamp if conversation already exists
      let timestamp = new Date().toISOString();
      try {
        const existingData = await fs.readFile(conversationFilePath, 'utf-8');
        const existing: ArchivedConversation = JSON.parse(existingData);
        timestamp = existing.timestamp;
      } catch {
        // New conversation, use new timestamp
      }

      // Calculate total tokens and cost from ALL messages
      let totalCost = 0;
      let tokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0
      };

      messages.forEach(msg => {
        if (msg.metadata?.cost) {
          totalCost += msg.metadata.cost;
        }
        if (msg.metadata?.tokens) {
          tokenUsage.inputTokens += msg.metadata.tokens.input || 0;
          tokenUsage.outputTokens += msg.metadata.tokens.output || 0;
        }
      });

      const conversation: ArchivedConversation = {
        messages,
        claudeSessionId,
        timestamp,
        totalCost,
        tokenUsage
      };

      await fs.writeFile(conversationFilePath, JSON.stringify(conversation, null, 2), 'utf-8');

      console.log('[PersistenceManager] Conversation saved with cost:', totalCost, 'tokens:', tokenUsage);
    } catch (error) {
      console.error('[PersistenceManager] Failed to save conversation:', error);
    }
  }

  /**
   * Gets all conversations for a specific session
   */
  async getConversations(sessionId: string): Promise<Array<{conversationId: string, timestamp: string, messageCount: number, firstMessage: string, isActive?: boolean}>> {
    try {
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        console.log('[PersistenceManager] Session not found:', sessionId);
        return [];
      }

      const conversations: Array<{conversationId: string, timestamp: string, messageCount: number, firstMessage: string, isActive?: boolean}> = [];
      const historyFolderPath = this.getHistoryFolderPath(session.name);

      try {
        const historyEntries = await fs.readdir(historyFolderPath);

        for (const historyFile of historyEntries) {
          if (!historyFile.endsWith('.json')) continue;

          const conversationId = historyFile.replace('.json', '');
          const historyFilePath = path.join(historyFolderPath, historyFile);
          const archivedData = await fs.readFile(historyFilePath, 'utf-8');
          const conv: ArchivedConversation = JSON.parse(archivedData);

          const firstUserMsg = conv.messages.find(m => m.type === 'user');
          conversations.push({
            conversationId,
            timestamp: conv.timestamp,
            messageCount: conv.messages.length,
            firstMessage: firstUserMsg ? firstUserMsg.content.substring(0, 100) : 'Conversation',
            isActive: conversationId === session.activeConversationId
          });
        }

        // Sort by isActive first (active conversation at top), then by timestamp descending
        conversations.sort((a, b) => {
          if (a.isActive && !b.isActive) return -1;
          if (!a.isActive && b.isActive) return 1;
          return b.timestamp.localeCompare(a.timestamp);
        });
      } catch {
        // No history folder yet
      }

      return conversations;
    } catch (error) {
      console.error('[PersistenceManager] Failed to get conversations:', error);
      return [];
    }
  }

  /**
   * Loads a conversation by conversationId, returns messages, claudeSessionId, and usage stats
   */
  async loadConversation(sessionId: string, conversationId: string): Promise<{
    messages: Message[],
    claudeSessionId?: string,
    totalCost?: number,
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    }
  }> {
    try {
      const { sessions } = await this.loadSessions();
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        console.error('[PersistenceManager] Session not found:', sessionId);
        return { messages: [] };
      }

      const conversationFilePath = path.join(this.getHistoryFolderPath(session.name), `${conversationId}.json`);
      const conversationData = await fs.readFile(conversationFilePath, 'utf-8');
      const conversation: ArchivedConversation = JSON.parse(conversationData);

      return {
        messages: conversation.messages,
        claudeSessionId: conversation.claudeSessionId,
        totalCost: conversation.totalCost,
        tokenUsage: conversation.tokenUsage
      };
    } catch (error) {
      console.error('[PersistenceManager] Failed to load conversation:', error);
      return { messages: [] };
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
        theme: 'auto',
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