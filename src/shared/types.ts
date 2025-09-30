// Shared types between main and renderer processes

export interface Session {
  id: string;
  name: string;
  workingDirectory: string;
  claudeSessionId?: string;
  activeConversationId?: string;
  model: 'opus' | 'sonnet' | 'sonnet1m' | 'default';
  createdAt: string;
  lastActive: string;
  isActive: boolean;
  isProcessing: boolean;
  yoloMode?: boolean;
}

export interface Conversation {
  id: string;
  sessionId: string;
  claudeSessionId?: string;
  name: string;
  createdAt: string;
  lastActive: string;
}

export interface Message {
  id: string;
  sessionId: string;
  conversationId?: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'system' | 'tool' | 'tool-result' | 'thinking' | 'error';
  content: string;
  metadata?: {
    cost?: number;
    tokens?: { input: number; output: number };
    toolName?: string;
    toolInfo?: string;
    rawInput?: any;
    isError?: boolean;
    hidden?: boolean;
    model?: string;
  };
}

export interface ClaudeStreamData {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  message?: any;
  session_id?: string;
  [key: string]: any;
}

export interface SessionConfig {
  model?: string;
  workingDirectory?: string;
  mcpConfigPath?: string;
  yoloMode?: boolean;
}

export interface PermissionRule {
  tool: string;
  path?: string;
  pattern?: string;
  allowed: boolean;
  createdAt: string;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  path: string;
  message: string;
  timestamp: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'auto';
  defaultModel: 'opus' | 'sonnet' | 'sonnet1m' | 'default';
  defaultWorkingDir?: string;
  alwaysAllowPermissions: PermissionRule[];
  wsl?: {
    enabled: boolean;
    distro: string;
    nodePath: string;
    claudePath: string;
  };
}

export interface ConversationData {
  sessionId: string;
  messages: Message[];
  totalCost: number;
  totalTokens: { input: number; output: number };
  startTime: string;
  endTime: string;
}

// IPC Channel names
export const IPC_CHANNELS = {
  // Session management
  CREATE_SESSION: 'session:create',
  DELETE_SESSION: 'session:delete',
  SWITCH_SESSION: 'session:switch',
  UPDATE_SESSION: 'session:update',
  GET_SESSIONS: 'session:get-all',
  GET_SESSION_MESSAGES: 'session:get-messages',
  SAVE_SESSION_MESSAGES: 'session:save-messages',

  // Claude communication
  SEND_MESSAGE: 'claude:send-message',
  STOP_PROCESS: 'claude:stop',
  STREAM_DATA: 'claude:stream-data',

  // Conversation management
  CREATE_CONVERSATION: 'conversation:create',
  GET_CONVERSATIONS: 'conversation:get-all',
  SWITCH_CONVERSATION: 'conversation:switch',
  DELETE_CONVERSATION: 'conversation:delete',
  GET_CONVERSATION_MESSAGES: 'conversation:get-messages',

  // Settings
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',

  // Permissions
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPONSE: 'permission:response',

  // Window
  MINIMIZE_WINDOW: 'window:minimize',
  MAXIMIZE_WINDOW: 'window:maximize',
  CLOSE_WINDOW: 'window:close',

  // Dialog
  SELECT_FOLDER: 'dialog:select-folder',
} as const;

// Window API type for TypeScript
declare global {
  interface Window {
    electronAPI: {
      createSession: (config?: SessionConfig) => Promise<Session>;
      deleteSession: (sessionId: string) => Promise<boolean>;
      switchSession: (sessionId: string) => Promise<Session | null>;
      getSessions: () => Promise<Session[]>;
      getSessionMessages: (sessionId: string) => Promise<Message[]>;
      saveSessionMessages: (sessionId: string, messages: Message[], claudeSessionId?: string) => Promise<void>;
      getArchivedConversations: (sessionId: string) => Promise<Array<{filename: string, timestamp: string, messageCount: number, firstMessage: string}>>;
      loadArchivedConversation: (filename: string) => Promise<Message[]>;
      getArchivedClaudeSessionId: (filename: string) => Promise<string | undefined>;
      createConversation: (sessionId: string) => Promise<Conversation>;
      getConversations: (sessionId: string) => Promise<Conversation[]>;
      switchConversation: (sessionId: string, conversationId: string) => Promise<Conversation | null>;
      deleteConversation: (sessionId: string, conversationId: string) => Promise<boolean>;
      getConversationMessages: (sessionId: string, conversationId: string) => Promise<Message[]>;
      sendMessage: (sessionId: string, message: string, config?: SessionConfig) => Promise<boolean>;
      stopProcess: (sessionId: string) => Promise<boolean>;
      onStreamData: (callback: (data: { sessionId: string; data: ClaudeStreamData }) => void) => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
      selectFolder: () => Promise<string | null>;
      onPermissionRequest: (callback: (request: PermissionRequest) => void) => void;
      respondToPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean) => Promise<void>;
    };
  }
}