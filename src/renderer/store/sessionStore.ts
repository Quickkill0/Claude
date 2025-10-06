import { create } from 'zustand';
import type { Session, Message, ClaudeStreamData } from '../../shared/types';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Map<string, Message[]>;
  isSidebarOpen: boolean;
  inputTexts: Map<string, string>; // sessionId -> input text

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
  loadConversation: (sessionId: string, conversationId: string) => Promise<void>;
  toggleYoloMode: (sessionId: string) => void;
  toggleThinkingMode: (sessionId: string) => void;
  togglePlanMode: (sessionId: string) => void;
  toggleChatMode: (sessionId: string) => void;
  addPermissionRequest: (request: import('../../shared/types').PermissionRequest) => void;
  respondToPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean, alwaysDeny?: boolean) => Promise<void>;
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
      // Get session and ensure we have an activeConversationId
      const session = get().sessions.find(s => s.id === sessionId);

      // If no active conversation, create one
      if (!session?.activeConversationId) {
        const newConversationId = crypto.randomUUID();
        console.log('[Send Message] Creating new conversation:', newConversationId);

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, activeConversationId: newConversationId } : s
          ),
        }));

        // Sync to backend
        await window.electronAPI.updateSession(sessionId, {
          activeConversationId: newConversationId,
        });
      }

      // Add user message immediately
      get().addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        type: 'user',
        content: message,
      });

      // Create checkpoint for user message
      try {
        const checkpointMessage = message.length > 50 ? message.substring(0, 47) + '...' : message;
        await window.electronAPI.createCheckpoint(sessionId, checkpointMessage);
      } catch (error) {
        console.error('Failed to create checkpoint:', error);
        // Don't fail the message send if checkpoint fails
      }

      // Update session processing state
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: true } : s
        ),
      }));

      // Get updated session to pass config
      const updatedSession = get().sessions.find(s => s.id === sessionId);
      const config = {
        ...(updatedSession?.yoloMode && { yoloMode: true }),
        ...(updatedSession?.thinkingMode && { thinkingMode: true }),
        ...(updatedSession?.planMode && { planMode: true }),
      };

      // Prepend Chat mode instructions if active
      let messageToSend = message;
      if (updatedSession?.chatMode) {
        messageToSend = 'DO NOT CODE ANYTHING. You are in chat-only mode. If the user asks you to create, edit, write, or modify any code or files, kindly explain that you cannot perform coding actions in this mode, but you can describe the steps needed or explain how to accomplish their goal. User message: ' + message;
      }

      await window.electronAPI.sendMessage(sessionId, messageToSend, Object.keys(config).length > 0 ? config : undefined);
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

    // Auto-save messages to persistence (conversationId will be added during auto-save after processing)
    const session = get().sessions.find(s => s.id === sessionId);
    window.electronAPI.saveSessionMessages(sessionId, session?.activeConversationId, updatedMessages);
  },

  handleStreamData: (sessionId: string, data: ClaudeStreamData) => {
    // Handle new MessageParser output format
    if (data.type === 'system' && data.subtype === 'message') {
      // New message from parser
      if (data.message) {
        get().addMessage(sessionId, data.message);

        // If this is a tool-result, clear pending state from the matching tool message
        // (this means permission was auto-granted via "Accept Always")
        if (data.message.type === 'tool-result' && data.message.metadata?.toolUseId) {
          const messages = new Map(get().messages);
          const sessionMessages = messages.get(sessionId) || [];

          // Find the tool message with matching toolUseId
          const updatedMessages = sessionMessages.map(m => {
            if (m.type === 'tool' && m.metadata?.toolUseId === data.message.metadata.toolUseId && m.metadata?.pendingPermission) {
              return {
                ...m,
                metadata: {
                  ...m.metadata,
                  pendingPermission: false,
                }
              };
            }
            return m;
          });

          if (updatedMessages !== sessionMessages) {
            messages.set(sessionId, updatedMessages);
            set({ messages });
          }
        }

        // If this is an ExitPlanMode tool result, automatically turn off plan mode
        if (data.message.type === 'tool-result') {
          const messages = new Map(get().messages);
          const sessionMessages = messages.get(sessionId) || [];

          // Find the matching tool message to check if it's ExitPlanMode
          const toolMessage = sessionMessages.find(m =>
            m.type === 'tool' &&
            m.metadata?.toolUseId === data.message.metadata?.toolUseId &&
            m.metadata?.toolName === 'ExitPlanMode'
          );

          if (toolMessage) {
            // Automatically disable plan mode
            const session = get().sessions.find(s => s.id === sessionId);
            if (session?.planMode) {
              get().togglePlanMode(sessionId);
            }
          }
        }
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

          if (session && sessionMessages.length > 0) {
            // Auto-save to history using activeConversationId
            console.log('[Auto-save] Saving conversation:', session.activeConversationId);
            window.electronAPI.saveSessionMessages(
              sessionId,
              session.activeConversationId,
              sessionMessages,
              session.claudeSessionId
            );
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
        const session = get().sessions.find(s => s.id === sessionId);
        const sessionMessages = get().messages.get(sessionId) || [];
        window.electronAPI.saveSessionMessages(sessionId, session?.activeConversationId, sessionMessages);
      }
    } else if (data.type === 'system' && data.subtype === 'stopped') {
      // Process was stopped by user
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isProcessing: false } : s
        ),
      }));

      // Save current state
      const session = get().sessions.find(s => s.id === sessionId);
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, session?.activeConversationId, sessionMessages);
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
      const session = get().sessions.find(s => s.id === sessionId);
      const sessionMessages = get().messages.get(sessionId) || [];
      window.electronAPI.saveSessionMessages(sessionId, session?.activeConversationId, sessionMessages);
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
    const session = get().sessions.find(s => s.id === sessionId);
    const sessionMessages = get().messages.get(sessionId) || [];

    // Save current conversation if there are messages
    if (sessionMessages.length > 0 && session?.activeConversationId) {
      console.log('[New Chat] Saving current conversation:', session.activeConversationId);
      await window.electronAPI.saveSessionMessages(
        sessionId,
        session.activeConversationId,
        sessionMessages,
        session.claudeSessionId
      );
    }

    // Generate new conversation ID
    const newConversationId = crypto.randomUUID();
    console.log('[New Chat] Starting new conversation:', newConversationId);

    // Clear messages and update session
    const messages = new Map(get().messages);
    messages.set(sessionId, []);
    set({ messages });

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, activeConversationId: newConversationId, claudeSessionId: undefined }
          : s
      ),
    }));

    // Sync to backend
    await window.electronAPI.updateSession(sessionId, {
      activeConversationId: newConversationId,
      claudeSessionId: undefined,
    });

    // Save empty state
    await window.electronAPI.saveSessionMessages(sessionId, undefined, []);
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

  loadConversation: async (sessionId: string, conversationId: string) => {
    try {
      // Load conversation data (messages + claudeSessionId)
      const { messages: conversationMessages, claudeSessionId } = await window.electronAPI.loadConversation(
        sessionId,
        conversationId
      );

      console.log('[Load Conversation] conversationId:', conversationId);
      console.log('[Load Conversation] claudeSessionId:', claudeSessionId);
      console.log('[Load Conversation] message count:', conversationMessages.length);

      // Set as current messages for this session
      const messages = new Map(get().messages);
      messages.set(sessionId, conversationMessages);
      set({ messages });

      // Update session to mark this conversation as active and restore claudeSessionId
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, activeConversationId: conversationId, claudeSessionId: claudeSessionId }
            : s
        ),
      }));

      // Sync to backend
      await window.electronAPI.updateSession(sessionId, {
        activeConversationId: conversationId,
        claudeSessionId: claudeSessionId,
      });

      console.log('[Load Conversation] Conversation loaded successfully');
    } catch (error) {
      console.error('[Load Conversation] Failed to load conversation:', error);
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

  toggleThinkingMode: async (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    const newThinkingMode = !session?.thinkingMode;

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, thinkingMode: newThinkingMode } : s
      ),
    }));

    // Save updated session metadata to backend
    await window.electronAPI.updateSession(sessionId, { thinkingMode: newThinkingMode });
  },

  togglePlanMode: async (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    const newPlanMode = !session?.planMode;

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, planMode: newPlanMode } : s
      ),
    }));

    // Save updated session metadata to backend
    await window.electronAPI.updateSession(sessionId, { planMode: newPlanMode });
  },

  toggleChatMode: async (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    const newChatMode = !session?.chatMode;

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, chatMode: newChatMode } : s
      ),
    }));

    // Save updated session metadata to backend
    await window.electronAPI.updateSession(sessionId, { chatMode: newChatMode });
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

  respondToPermission: async (requestId: string, allowed: boolean, alwaysAllow: boolean, alwaysDeny?: boolean) => {
    try {
      const updatedSessions = await window.electronAPI.respondToPermission(requestId, allowed, alwaysAllow, alwaysDeny);

      // Update sessions with latest permissions if alwaysAllow or alwaysDeny was checked
      if (updatedSessions && (alwaysAllow || alwaysDeny)) {
        set({ sessions: updatedSessions });
      }

      // Remove the permission request message and update pending tool messages
      const messages = new Map(get().messages);
      let deniedSessionId: string | null = null;

      for (const [sessionId, sessionMessages] of messages.entries()) {
        let updated = false;
        const updatedMessages = sessionMessages.map(m => {
          // Remove permission request message
          if (m.id === requestId) {
            updated = true;
            // If denied, track the sessionId to stop the process
            if (!allowed && m.metadata?.permissionRequest) {
              deniedSessionId = m.metadata.permissionRequest.sessionId;
            }
            return null;
          }
          // Update pending tool messages to show granted/denied status
          if (m.type === 'tool' && m.metadata?.pendingPermission) {
            updated = true;
            return {
              ...m,
              metadata: {
                ...m.metadata,
                pendingPermission: false,
                permissionDenied: !allowed,
              }
            };
          }
          return m;
        }).filter(m => m !== null) as Message[];

        if (updated) {
          messages.set(sessionId, updatedMessages);
          set({ messages });
          // Save updated messages
          window.electronAPI.saveSessionMessages(sessionId, updatedMessages);
          break;
        }
      }

      // If permission was denied, automatically stop the process
      if (!allowed && deniedSessionId) {
        await window.electronAPI.stopProcess(deniedSessionId);
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