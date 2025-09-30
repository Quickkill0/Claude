import { create } from 'zustand';
import type { Session, Message, ClaudeStreamData } from '../../shared/types';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Map<string, Message[]>;
  isSidebarOpen: boolean;
  streamingMessages: Map<string, Map<string, Message>>; // sessionId -> messageId -> Message
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
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  isSidebarOpen: true,
  streamingMessages: new Map(),
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

      // Listen for stream data
      window.electronAPI.onStreamData((data: { sessionId: string; data: ClaudeStreamData }) => {
        get().handleStreamData(data.sessionId, data.data);
      });
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
    // Process different types of stream data based on plugin's MessageHandler
    const messageId = data.message?.id || crypto.randomUUID();

    console.log('handleStreamData:', data.type, data.subtype, messageId);

    if (data.type === 'assistant' && data.message?.content) {
      // Get or create streaming messages map for this session
      const streamingMessages = get().streamingMessages;
      let sessionStreamMap = streamingMessages.get(sessionId);
      if (!sessionStreamMap) {
        sessionStreamMap = new Map();
        streamingMessages.set(sessionId, sessionStreamMap);
      }

      // Process each content item in the assistant message
      for (const content of data.message.content) {
        if (content.type === 'text' && content.text) {
          console.log('Text chunk:', content.text);
          // Accumulate text content for this message ID
          const existingMessage = sessionStreamMap.get(`text-${messageId}`);
          if (existingMessage) {
            // Check if this chunk is already in the message (Claude Code bug workaround)
            if (existingMessage.content.includes(content.text)) {
              console.log('Duplicate chunk detected, skipping');
              continue;
            }
            // Append to existing message
            console.log('Appending to existing message, current content:', existingMessage.content);
            existingMessage.content += content.text;
            // Update the message in the list
            const messages = new Map(get().messages);
            const sessionMessages = messages.get(sessionId) || [];
            const msgIndex = sessionMessages.findIndex(m => m.id === existingMessage.id);
            if (msgIndex !== -1) {
              sessionMessages[msgIndex] = { ...existingMessage };
              const updatedMessages = [...sessionMessages];
              messages.set(sessionId, updatedMessages);
              set({ messages });
              // Don't auto-save during streaming chunks
            }
          } else {
            // Create new message for this text stream
            const newMessage: Message = {
              id: crypto.randomUUID(),
              sessionId,
              timestamp: new Date().toISOString(),
              type: 'assistant',
              content: content.text,
            };
            sessionStreamMap.set(`text-${messageId}`, newMessage);
            get().addMessage(sessionId, newMessage);
          }
        } else if (content.type === 'thinking' && content.thinking) {
          // Accumulate thinking content
          const existingMessage = sessionStreamMap.get(`thinking-${messageId}`);
          if (existingMessage) {
            existingMessage.content += content.thinking;
            const messages = new Map(get().messages);
            const sessionMessages = messages.get(sessionId) || [];
            const msgIndex = sessionMessages.findIndex(m => m.id === existingMessage.id);
            if (msgIndex !== -1) {
              sessionMessages[msgIndex] = { ...existingMessage };
              const updatedMessages = [...sessionMessages];
              messages.set(sessionId, updatedMessages);
              set({ messages });
              // Don't auto-save during streaming chunks
            }
          } else {
            const newMessage: Message = {
              id: crypto.randomUUID(),
              sessionId,
              timestamp: new Date().toISOString(),
              type: 'thinking',
              content: content.thinking,
            };
            sessionStreamMap.set(`thinking-${messageId}`, newMessage);
            get().addMessage(sessionId, newMessage);
          }
        } else if (content.type === 'tool_use') {
          // Tool execution - these don't accumulate
          const toolInfo = `🔧 Executing: ${content.name}`;
          let toolInput = '';

          if (content.input) {
            // Special formatting for TodoWrite
            if (content.name === 'TodoWrite' && content.input.todos) {
              toolInput = '\nTodo List Update:';
              for (const todo of content.input.todos) {
                const status = todo.status === 'completed' ? '✅' :
                  todo.status === 'in_progress' ? '🔄' : '⏳';
                toolInput += `\n${status} ${todo.content}`;
              }
            }
          }

          get().addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            timestamp: new Date().toISOString(),
            type: 'tool',
            content: toolInput || toolInfo,
            metadata: {
              toolName: content.name,
              toolInfo: toolInfo,
              rawInput: content.input,
            },
          });
        }
      }
    } else if (data.type === 'user' && data.message?.content) {
      // Process tool results from user messages
      for (const content of data.message.content) {
        if (content.type === 'tool_result') {
          let resultContent = content.content || 'Tool executed successfully';

          // Stringify if content is an object or array
          if (typeof resultContent === 'object' && resultContent !== null) {
            resultContent = JSON.stringify(resultContent, null, 2);
          }

          const isError = content.is_error || false;
          const toolName = content.tool_name || 'Unknown';

          // Don't show tool result for Read, Edit, TodoWrite, MultiEdit unless there's an error
          const shouldHide = (toolName === 'Read' || toolName === 'Edit' ||
                             toolName === 'TodoWrite' || toolName === 'MultiEdit') && !isError;

          if (!shouldHide) {
            get().addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              timestamp: new Date().toISOString(),
              type: 'tool-result',
              content: resultContent,
              metadata: {
                isError: isError,
                toolName: toolName,
                hidden: shouldHide,
              },
            });
          }
        }
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
    } else if (data.type === 'result' && data.subtype === 'success') {
      // Clear streaming messages for this session
      const streamingMessages = get().streamingMessages;
      streamingMessages.delete(sessionId);
      set({ streamingMessages: new Map(streamingMessages) });

      // Update session processing state
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));

      // Save messages now that streaming is complete
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
    } else if (data.type === 'system' && data.subtype === 'stopped') {
      // Process was stopped by user
      const streamingMessages = get().streamingMessages;
      streamingMessages.delete(sessionId);
      set({ streamingMessages: new Map(streamingMessages) });

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));

      // Save current state
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
    } else if (data.type === 'system' && data.subtype === 'error') {
      // Clear streaming messages for this session
      const streamingMessages = get().streamingMessages;
      streamingMessages.delete(sessionId);
      set({ streamingMessages: new Map(streamingMessages) });

      get().addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        type: 'error',
        content: data.message?.content || 'An error occurred',
      });

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
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
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

    // Archive messages if there are any
    if (sessionMessages.length > 0 && session) {
      let archiveKey: string;

      if (loadedArchiveKey) {
        // Update the existing archive that was loaded
        archiveKey = loadedArchiveKey;
        console.log('startNewChat - updating existing archive:', archiveKey, 'with claudeSessionId:', session.claudeSessionId);
      } else {
        // Create new archive with timestamp
        const timestamp = new Date().toISOString();
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

  updateSessionModel: (sessionId: string, model: 'opus' | 'sonnet' | 'sonnet1m' | 'default') => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, model } : s
      ),
    }));

    // Save updated session
    const sessionMessages = get().messages.get(sessionId) || [];
    window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
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

  toggleYoloMode: (sessionId: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, yoloMode: !s.yoloMode } : s
      ),
    }));

    // Save updated session
    const sessionMessages = get().messages.get(sessionId) || [];
    window.electronAPI.saveSessionMessages(sessionId, sessionMessages);
  },
}));