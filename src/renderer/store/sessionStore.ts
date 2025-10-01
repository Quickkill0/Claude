import { create } from 'zustand';
import type { Session, Message, ClaudeStreamData } from '../../shared/types';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Map<string, Message[]>;
  isSidebarOpen: boolean;
  inputTexts: Map<string, string>; // sessionId -> input text
  loadedArchivedConversation: Map<string, string | null>; // sessionId -> archived conversation key (if loaded from history)

  // Actions
  initializeSessions: () => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, message: string) => Promise<void>;
  stopProcess: (sessionId: string) => Promise<void>;
  addMessage: (sessionId: string, message: Message) => void;
  handleStreamData: (sessionId: string, data: ClaudeStreamData) => void;
  toggleSidebar: () => void;
  setInputText: (sessionId: string, text: string) => void;
  getInputText: (sessionId: string) => string;
  startNewChat: (sessionId: string) => void;
  updateSessionModel: (sessionId: string, model: 'opus' | 'sonnet' | 'sonnet1m' | 'default') => void;
  loadArchivedConversation: (sessionId: string, filename: string) => Promise<void>;
  toggleYoloMode: (sessionId: string) => void;
  addPermissionRequest: (request: import('../../shared/types').PermissionRequest) => void;
  respondToPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean) => Promise<void>;
  removeSessionPermission: (sessionId: string, index: number) => Promise<void>;
}

// Track if stream listener is already registered
let streamListenerRegistered = false;

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  isSidebarOpen: localStorage.getItem('sidebarOpen') !== 'false', // Default to true unless explicitly set to false
  inputTexts: new Map(),
  loadedArchivedConversation: new Map(),

  initializeSessions: async () => {
    try {
      const sessions = await window.electronAPI.getSessions();
      set({ sessions });

      // Load messages for all sessions
      const messages = new Map<string, Message[]>();
      for (const session of sessions) {
        const sessionMessages = await window.electronAPI.getSessionMessages(session.id);
        messages.set(session.id, sessionMessages);
      }
      set({ messages });

      // Don't auto-create first session - let user choose folder
      const activeSession = sessions.find((s) => s.isActive);
      if (activeSession) {
        set({ activeSessionId: activeSession.id });
      }

      // Listen for stream data - only register once!
      if (!streamListenerRegistered) {
        window.electronAPI.onStreamData((data: { sessionId: string; data: ClaudeStreamData }) => {
          get().handleStreamData(data.sessionId, data.data);
        });
        streamListenerRegistered = true;
      }
    } catch (error) {
      console.error('Failed to initialize sessions:', error);
    }
  },

  createSession: async () => {
    try {
      // Open folder selection dialog
      const folderPath = await window.electronAPI.selectFolder();

      // User cancelled the dialog
      if (!folderPath) {
        return;
      }

      // Create session with selected folder
      const session = await window.electronAPI.createSession({
        workingDirectory: folderPath,
      });

      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
      }));
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await window.electronAPI.deleteSession(sessionId);
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      }));

      // Clean up messages
      const newMessages = new Map(get().messages);
      newMessages.delete(sessionId);
      set({ messages: newMessages });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  },

  switchSession: async (sessionId: string) => {
    try {
      const session = await window.electronAPI.switchSession(sessionId);
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => ({
            ...s,
            isActive: s.id === sessionId,
          })),
          activeSessionId: sessionId,
        }));
      }
    } catch (error) {
      console.error('Failed to switch session:', error);
    }
  },

  sendMessage: async (sessionId: string, message: string) => {
    try {
      // Add user message immediately
      get().addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        type: 'user',
        content: message,
      });

      // Keep the loaded archive flag - we'll update the same archive when starting new chat
      // Don't clear it here, otherwise we'll create duplicate archives

      // Update session processing state
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: true } : s
        ),
      }));

      // Get session to pass yoloMode config
      const session = get().sessions.find(s => s.id === sessionId);
      const config = session?.yoloMode ? { yoloMode: true } : undefined;

      await window.electronAPI.sendMessage(sessionId, message, config);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  },

  stopProcess: async (sessionId: string) => {
    try {
      await window.electronAPI.stopProcess(sessionId);
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));
    } catch (error) {
      console.error('Failed to stop process:', error);
    }
  },

  addMessage: (sessionId: string, message: Message) => {
    const messages = new Map(get().messages);
    const sessionMessages = messages.get(sessionId) || [];

    // Check if message already exists (by ID) to prevent duplicates
    const messageExists = sessionMessages.some(m => m.id === message.id);
    if (messageExists) {
      return;
    }

    const updatedMessages = [...sessionMessages, message];
    messages.set(sessionId, updatedMessages);
    set({ messages });

    // Auto-save messages to persistence
    window.electronAPI.saveSessionMessages(sessionId, updatedMessages);
  },

  handleStreamData: (sessionId: string, data: ClaudeStreamData) => {
    // Handle new MessageParser output format
    if (data.type === 'system' && data.subtype === 'message') {
      // New message from parser
      if (data.message) {
        get().addMessage(sessionId, data.message);
      }
    } else if (data.type === 'system' && data.subtype === 'message-update') {
      // Message update (streaming delta)
      if (data.updates && data.updates.id) {
        const messages = new Map(get().messages);
        const sessionMessages = messages.get(sessionId) || [];
        const msgIndex = sessionMessages.findIndex(m => m.id === data.updates.id);

        if (msgIndex !== -1) {
          const updatedMessages = [...sessionMessages];
          updatedMessages[msgIndex] = {
            ...updatedMessages[msgIndex],
            ...data.updates,
          };
          messages.set(sessionId, updatedMessages);
          set({ messages });
          // Don't auto-save during streaming chunks
        }
      }
    } else if (data.type === 'system' && data.subtype === 'session-state-update') {
      // Update session state (e.g., isProcessing)
      if (data.sessionUpdate) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, ...data.sessionUpdate } : s
          ),
        }));

        // Save messages if processing is complete
        if (data.sessionUpdate.isProcessing === false) {
          const sessionMessages = get().messages.get(sessionId) || [];
          const session = get().sessions.find(s => s.id === sessionId);
          const loadedArchiveKey = get().loadedArchivedConversation.get(sessionId);

          // Save current messages to session
          window.electronAPI.saveSessionMessages(sessionId, sessionMessages);

          // Auto-save to history
          if (session && sessionMessages.length > 0) {
            if (loadedArchiveKey && !loadedArchiveKey.endsWith('-current')) {
              // Update the resumed archived conversation
              console.log('[Auto-save] Updating resumed archive:', loadedArchiveKey);
              window.electronAPI.saveSessionMessages(loadedArchiveKey, sessionMessages, session.claudeSessionId);
            } else {
              // Save to current conversation
              console.log('[Auto-save] Saving to current conversation');
              window.electronAPI.saveCurrentConversation(sessionId, sessionMessages, session.claudeSessionId);

              // Mark that we're now working with current conversation
              const loadedArchives = new Map(get().loadedArchivedConversation);
              loadedArchives.set(sessionId, `${sessionId}-current`);
              set({ loadedArchivedConversation: loadedArchives });
            }
          }
        }
      }
    } else if (data.type === 'system' && data.subtype === 'stats') {
      // Update session with token usage and cost
      if (data.stats) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? {
              ...s,
              totalCost: (s.totalCost || 0) + (data.stats?.cost || 0),
              tokenUsage: {
                inputTokens: (s.tokenUsage?.inputTokens || 0) + (data.stats?.tokens?.input || 0),
                outputTokens: (s.tokenUsage?.outputTokens || 0) + (data.stats?.tokens?.output || 0),
                cacheCreationTokens: s.tokenUsage?.cacheCreationTokens || 0,
                cacheReadTokens: s.tokenUsage?.cacheReadTokens || 0,
              },
            } : s
          ),
        }));
      }
    } else if (data.type === 'system' && data.subtype === 'session-updated') {
      // Update session with new claudeSessionId
      if (data.session) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, claudeSessionId: data.session.claudeSessionId } : s
          ),
        }));
        // Save the updated session
        const sessionMessages = get().messages.get(sessionId) || [];
        window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
      }
    } else if (data.type === 'system' && data.subtype === 'stopped') {
      // Process was stopped by user
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));

      // Save current state
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
    } else if (data.type === 'system' && data.subtype === 'error') {
      // Add error message if not already created by parser
      if (data.message?.content) {
        get().addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          timestamp: new Date().toISOString(),
          type: 'error',
          content: data.message.content,
        });
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));

      // Save messages with error
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
    }
  },

  toggleSidebar: () => {
    set((state) => {
      const newState = !state.isSidebarOpen;
      localStorage.setItem('sidebarOpen', String(newState));
      return { isSidebarOpen: newState };
    });
  },

  setInputText: (sessionId: string, text: string) => {
    const inputTexts = new Map(get().inputTexts);
    inputTexts.set(sessionId, text);
    set({ inputTexts });
  },

  getInputText: (sessionId: string) => {
    return get().inputTexts.get(sessionId) || '';
  },

  startNewChat: async (sessionId: string) => {
    const sessionMessages = get().messages.get(sessionId) || [];
    const loadedArchiveKey = get().loadedArchivedConversation.get(sessionId);
    const session = get().sessions.find(s => s.id === sessionId);

    console.log('startNewChat - sessionId:', sessionId);
    console.log('startNewChat - workingDirectory:', session?.workingDirectory);
    console.log('startNewChat - loadedArchiveKey:', loadedArchiveKey);
    console.log('startNewChat - sessionMessages:', sessionMessages);
    console.log('startNewChat - claudeSessionId:', session?.claudeSessionId);

    // Archive current conversation if there are any messages
    if (sessionMessages.length > 0 && session) {
      let archiveKey: string;

      if (loadedArchiveKey && !loadedArchiveKey.endsWith('-current')) {
        // Update the existing archive that was loaded (but not current.json)
        archiveKey = loadedArchiveKey;
        console.log('startNewChat - updating existing archive:', archiveKey, 'with claudeSessionId:', session.claudeSessionId);
      } else {
        // Create new archive with timestamp (replace colons with hyphens for Windows compatibility)
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const normalizedPath = session.workingDirectory.replace(/\\/g, '/');
        archiveKey = `${normalizedPath}-${timestamp}`;
        console.log('startNewChat - creating new archive:', archiveKey, 'with claudeSessionId:', session.claudeSessionId);
      }

      // Pass claudeSessionId when archiving - AWAIT to ensure it completes before clearing messages
      await window.electronAPI.saveSessionMessages(archiveKey, sessionMessages, session.claudeSessionId);
      console.log('startNewChat - archive saved successfully');
    } else {
      console.log('startNewChat - skipping archive (no messages)');
    }

    // Clear current messages and loaded archive flag
    const messages = new Map(get().messages);
    messages.set(sessionId, []);
    set({ messages });

    const loadedArchives = new Map(get().loadedArchivedConversation);
    loadedArchives.set(sessionId, null);
    set({ loadedArchivedConversation: loadedArchives });

    // Clear claudeSessionId to start fresh
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, claudeSessionId: undefined } : s
      ),
    }));

    // Save updated session state
    await window.electronAPI.saveSessionMessages(sessionId, []);
  },

  updateSessionModel: async (sessionId: string, model: 'opus' | 'sonnet' | 'sonnet1m' | 'default') => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, model } : s
      ),
    }));

    // Save updated session metadata to backend
    await window.electronAPI.updateSession(sessionId, { model });
  },

  loadArchivedConversation: async (sessionId: string, filename: string) => {
    try {
      // Load archived messages and claudeSessionId
      const [archivedMessages, claudeSessionId] = await Promise.all([
        window.electronAPI.loadArchivedConversation(filename),
        window.electronAPI.getArchivedClaudeSessionId(filename)
      ]);

      console.log('loadArchivedConversation - filename:', filename);
      console.log('loadArchivedConversation - claudeSessionId:', claudeSessionId);

      // Set as current messages for this session
      const messages = new Map(get().messages);
      messages.set(sessionId, archivedMessages);
      set({ messages });

      // Mark that this session is showing an archived conversation
      const loadedArchives = new Map(get().loadedArchivedConversation);
      loadedArchives.set(sessionId, filename);
      set({ loadedArchivedConversation: loadedArchives });

      // Restore the claudeSessionId so the conversation can be resumed
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, claudeSessionId: claudeSessionId } : s
        ),
      }));

      console.log('loadArchivedConversation - restored claudeSessionId to session');
    } catch (error) {
      console.error('Failed to load archived conversation:', error);
    }
  },

  toggleYoloMode: async (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    const newYoloMode = !session?.yoloMode;

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, yoloMode: newYoloMode } : s
      ),
    }));

    // Save updated session metadata to backend
    await window.electronAPI.updateSession(sessionId, { yoloMode: newYoloMode });
  },

  addPermissionRequest: (request: import('../../shared/types').PermissionRequest) => {
    // Add permission request as a message in the chat
    const message: Message = {
      id: request.id,
      sessionId: request.sessionId,
      timestamp: request.timestamp,
      type: 'permission-request',
      content: request.message,
      metadata: {
        permissionRequest: request,
      },
    };
    get().addMessage(request.sessionId, message);
  },

  respondToPermission: async (requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    try {
      const updatedSessions = await window.electronAPI.respondToPermission(requestId, allowed, alwaysAllow);

      // Update sessions with latest permissions if alwaysAllow was checked
      if (updatedSessions && alwaysAllow && allowed) {
        set({ sessions: updatedSessions });
      }

      // Remove the permission request message from the chat
      const messages = new Map(get().messages);
      for (const [sessionId, sessionMessages] of messages.entries()) {
        const filteredMessages = sessionMessages.filter(m => m.id !== requestId);
        if (filteredMessages.length !== sessionMessages.length) {
          messages.set(sessionId, filteredMessages);
          set({ messages });
          // Save updated messages
          window.electronAPI.saveSessionMessages(sessionId, filteredMessages);
          break;
        }
      }
    } catch (error) {
      console.error('Failed to respond to permission:', error);
    }
  },

  removeSessionPermission: async (sessionId: string, index: number) => {
    try {
      // Call backend to remove permission and get updated sessions
      const updatedSessions = await window.electronAPI.removeSessionPermission(sessionId, index);

      // Update local state with backend response
      set({ sessions: updatedSessions });
    } catch (error) {
      console.error('Failed to remove session permission:', error);
    }
  },
}));