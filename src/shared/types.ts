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
  isOpen?: boolean; // Track if session should be loaded on startup
  yoloMode?: boolean;
  thinkingMode?: boolean;
  planMode?: boolean;
  sessionPermissions?: PermissionRule[];
  totalCost?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

export interface Conversation {
  id: string;
  sessionId: string;
  claudeSessionId?: string;
  name: string;
  createdAt: string;
  lastActive: string;
}

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  tool_use?: {
    id: string;
    name: string;
    input: any;
  };
  tool_result?: {
    tool_use_id: string;
    content: any;
    is_error?: boolean;
  };
}

export interface Message {
  id: string;
  sessionId: string;
  conversationId?: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'system' | 'tool' | 'tool-result' | 'thinking' | 'error' | 'permission-request';
  content: string;
  contentBlocks?: ContentBlock[];
  metadata?: {
    cost?: number;
    tokens?: { input: number; output: number };
    toolName?: string;
    toolInfo?: string;
    rawInput?: any;
    isError?: boolean;
    hidden?: boolean;
    model?: string;
    permissionRequest?: PermissionRequest;
    toolUseId?: string;
    contentBlockIndex?: number;
    pendingPermission?: boolean;
    permissionDenied?: boolean;
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
  thinkingMode?: boolean;
  planMode?: boolean;
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
  input?: any; // Tool-specific input data (e.g., command for Bash)
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

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  content: string;
  source: 'project' | 'personal' | 'builtin';
}

export interface Agent {
  name: string;
  description: string;
  tools?: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  systemPrompt: string;
  source: 'project' | 'personal';
  filePath: string;
}

export type MCPServerType = 'stdio' | 'http' | 'sse';
export type MCPScope = 'project' | 'personal';

export interface MCPServer {
  name: string;
  type: MCPServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  source: MCPScope;
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

  // Slash Commands
  GET_SLASH_COMMANDS: 'slash-commands:get',

  // Agents
  GET_AGENTS: 'agents:get',
  CREATE_AGENT: 'agents:create',
  UPDATE_AGENT: 'agents:update',
  DELETE_AGENT: 'agents:delete',

  // MCPs
  GET_MCPS: 'mcps:get',
  CREATE_MCP: 'mcps:create',
  UPDATE_MCP: 'mcps:update',
  DELETE_MCP: 'mcps:delete',
} as const;

// Window API type for TypeScript
declare global {
  interface Window {
    electronAPI: {
      createSession: (config?: SessionConfig) => Promise<Session>;
      deleteSession: (sessionId: string) => Promise<boolean>;
      switchSession: (sessionId: string) => Promise<Session | null>;
      updateSession: (sessionId: string, updates: Partial<Session>) => Promise<Session | null>;
      getSessions: () => Promise<Session[]>;
      getSessionMessages: (sessionId: string) => Promise<Message[]>;
      saveSessionMessages: (sessionId: string, conversationId: string | undefined, messages: Message[], claudeSessionId?: string) => Promise<void>;
      getConversations: (sessionId: string) => Promise<Array<{conversationId: string, timestamp: string, messageCount: number, firstMessage: string, isActive?: boolean}>>;
      loadConversation: (sessionId: string, conversationId: string) => Promise<{ messages: Message[], claudeSessionId?: string }>;
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
      respondToPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean) => Promise<Session[]>;
      removeSessionPermission: (sessionId: string, index: number) => Promise<Session[]>;
      getSlashCommands: (sessionId: string) => Promise<SlashCommand[]>;
      getAgents: (sessionId: string) => Promise<Agent[]>;
      createAgent: (sessionId: string, agent: Omit<Agent, 'filePath'>, scope: 'project' | 'personal') => Promise<string>;
      updateAgent: (agent: Agent) => Promise<void>;
      deleteAgent: (filePath: string) => Promise<void>;
      getMCPs: (sessionId: string) => Promise<MCPServer[]>;
      createMCP: (sessionId: string, mcp: Omit<MCPServer, 'source'>, scope: MCPScope) => Promise<void>;
      updateMCP: (sessionId: string, oldName: string, mcp: MCPServer) => Promise<void>;
      deleteMCP: (sessionId: string, name: string, scope: MCPScope) => Promise<void>;
    };
  }
}