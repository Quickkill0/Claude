import { contextBridge, ipcRenderer } from 'electron';

// IPC Channel names - duplicated here to avoid module resolution issues in preload
const IPC_CHANNELS = {
  CREATE_SESSION: 'session:create',
  DELETE_SESSION: 'session:delete',
  SWITCH_SESSION: 'session:switch',
  UPDATE_SESSION: 'session:update',
  GET_SESSIONS: 'session:get-all',
  GET_SESSION_MESSAGES: 'session:get-messages',
  SAVE_SESSION_MESSAGES: 'session:save-messages',
  SEND_MESSAGE: 'claude:send-message',
  STOP_PROCESS: 'claude:stop',
  STREAM_DATA: 'claude:stream-data',
  SAVE_CONVERSATION: 'conversation:save',
  LOAD_CONVERSATION: 'conversation:load',
  GET_CONVERSATIONS: 'conversation:get-all',
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPONSE: 'permission:response',
  MINIMIZE_WINDOW: 'window:minimize',
  MAXIMIZE_WINDOW: 'window:maximize',
  CLOSE_WINDOW: 'window:close',
  SELECT_FOLDER: 'dialog:select-folder',
  GET_SLASH_COMMANDS: 'slash-commands:get',
  GET_AGENTS: 'agents:get',
  CREATE_AGENT: 'agents:create',
  UPDATE_AGENT: 'agents:update',
  DELETE_AGENT: 'agents:delete',
} as const;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Session management
  createSession: (config: any) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, config),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  switchSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.SWITCH_SESSION, sessionId),
  updateSession: (sessionId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SESSION, { sessionId, updates }),
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  getSessionMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_MESSAGES, sessionId),
  saveSessionMessages: (sessionId: string, conversationId: string | undefined, messages: any[], claudeSessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_SESSION_MESSAGES, { sessionId, conversationId, messages, claudeSessionId }),
  getConversations: (sessionId: string) => ipcRenderer.invoke('session:get-conversations', sessionId),
  loadConversation: (sessionId: string, conversationId: string) => ipcRenderer.invoke('session:load-conversation', { sessionId, conversationId }),

  // Claude communication
  sendMessage: (sessionId: string, message: string, config: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, { sessionId, message, config }),
  stopProcess: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.STOP_PROCESS, sessionId),

  // Listen for stream data
  onStreamData: (callback: (data: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.STREAM_DATA, (_, data) => callback(data));
  },

  // Permissions
  onPermissionRequest: (callback: (request: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.PERMISSION_REQUEST, (_, request) => callback(request));
  },
  respondToPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.PERMISSION_RESPONSE, { requestId, allowed, alwaysAllow }),
  removeSessionPermission: (sessionId: string, index: number) =>
    ipcRenderer.invoke('session:remove-permission', { sessionId, index }),

  // Window controls
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.MINIMIZE_WINDOW),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.MAXIMIZE_WINDOW),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.CLOSE_WINDOW),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),

  // Dialog
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),

  // Slash Commands
  getSlashCommands: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_SLASH_COMMANDS, sessionId),

  // Agents
  getAgents: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS, sessionId),
  createAgent: (sessionId: string, agent: any, scope: 'project' | 'personal') =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_AGENT, { sessionId, agent, scope }),
  updateAgent: (agent: any) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_AGENT, agent),
  deleteAgent: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_AGENT, filePath),
});