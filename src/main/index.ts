import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import { MultiSessionManager } from './MultiSessionManager';
import { PersistenceManager } from './PersistenceManager';
import { SlashCommandParser } from './SlashCommandParser';
import { AgentParser } from './AgentParser';
import { IPC_CHANNELS, PermissionRequest } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let sessionManager: MultiSessionManager;
let persistenceManager: PersistenceManager;
let pendingPermissions: Map<string, { resolve: (allowed: boolean) => void; request: PermissionRequest }> = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false, // Custom title bar
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the app
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize managers
async function initializeManagers() {
  persistenceManager = new PersistenceManager();
  await persistenceManager.initialize();

  sessionManager = new MultiSessionManager(
    (sessionId, data) => {
      // Send stream data to renderer
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.STREAM_DATA, { sessionId, data });
      }
    },
    async (sessionId, tool, path, message) => {
      // Handle permission request
      return await handlePermissionRequest(sessionId, tool, path, message);
    }
  );

  // Load persisted sessions and filter to only open sessions
  const { sessions, messagesMap } = await persistenceManager.loadSessions();
  // Only restore sessions that were open when app was closed
  // For backward compatibility, treat undefined isOpen as true (existing sessions)
  const openSessions = sessions.filter(s => s.isOpen !== false);
  sessionManager.restoreSessions(openSessions, messagesMap);

  // Load permissions for all open sessions
  for (const session of openSessions) {
    await sessionManager.loadSessionPermissions(session.id);
  }
}

// Handle permission request
async function handlePermissionRequest(sessionId: string, tool: string, filePath: string, message: string): Promise<boolean> {
  console.log('[PERMISSION REQUEST]', { sessionId, tool, filePath, message });

  // Check always-allow permissions first
  const settings = await persistenceManager.getSettings();
  const isAllowed = settings.alwaysAllowPermissions.some(rule => {
    if (rule.tool !== tool) return false;
    if (rule.path && rule.path === filePath) return true;
    if (rule.pattern && new RegExp(rule.pattern).test(filePath)) return true;
    return false;
  });

  console.log('[PERMISSION] Always-allow check:', isAllowed);

  if (isAllowed) {
    return true;
  }

  // Send permission request to renderer and wait for response
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const request: PermissionRequest = {
      id: requestId,
      sessionId,
      tool,
      path: filePath,
      message,
      timestamp: new Date().toISOString(),
    };

    console.log('[PERMISSION] Sending request to renderer:', requestId);
    pendingPermissions.set(requestId, { resolve, request });

    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.PERMISSION_REQUEST, request);
    } else {
      console.log('[PERMISSION] No main window, denying');
      resolve(false);
    }
  });
}

// Set up IPC handlers
function setupIPCHandlers() {
  // Session management
  ipcMain.handle(IPC_CHANNELS.CREATE_SESSION, async (_, config) => {
    const session = await sessionManager.createSession(config);
    await persistenceManager.saveSession(session, []);
    return session;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SESSION, async (_, sessionId: string) => {
    // Mark session as closed and persist, then remove from active sessions
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.isOpen = false;
      const messages = await persistenceManager.getSessionMessages(sessionId);
      await persistenceManager.saveSession(session, messages);
    }

    // Remove from active sessions in memory
    const result = await sessionManager.deleteSession(sessionId);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.SWITCH_SESSION, async (_, sessionId: string) => {
    return await sessionManager.switchToSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async () => {
    return sessionManager.getAllSessions();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_MESSAGES, async (_, sessionId: string) => {
    return await persistenceManager.getSessionMessages(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_SESSION_MESSAGES, async (_, { sessionId, messages, claudeSessionId }) => {
    // Check if this is an archived conversation key (path-timestamp format)
    // Archive keys contain a path separator (/ or \) unlike UUIDs
    const isArchiveKey = sessionId.includes('/') || sessionId.includes('\\');

    console.log('SAVE_SESSION_MESSAGES - sessionId:', sessionId);
    console.log('SAVE_SESSION_MESSAGES - isArchiveKey:', isArchiveKey);
    console.log('SAVE_SESSION_MESSAGES - claudeSessionId:', claudeSessionId);

    if (isArchiveKey) {
      // This is an archived conversation key, save directly with claudeSessionId
      console.log('SAVE_SESSION_MESSAGES - saving as archived');
      await persistenceManager.saveArchivedMessages(sessionId, messages, claudeSessionId);
    } else {
      // Normal session save - get latest session state from memory
      console.log('SAVE_SESSION_MESSAGES - saving as session');
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        // Update claudeSessionId if provided
        if (claudeSessionId) {
          session.claudeSessionId = claudeSessionId;
        }
        await persistenceManager.saveSession(session, messages);
      }
    }
  });

  // Add UPDATE_SESSION handler to sync session metadata changes from frontend
  ipcMain.handle(IPC_CHANNELS.UPDATE_SESSION, async (_, { sessionId, updates }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      // Apply updates to session
      Object.assign(session, updates);

      // Save the updated session
      const messages = await persistenceManager.getSessionMessages(sessionId);
      await persistenceManager.saveSession(session, messages);

      return session;
    }
    return null;
  });

  ipcMain.handle('session:get-archived-conversations', async (_, sessionId: string) => {
    console.log('IPC: get-archived-conversations called with sessionId:', sessionId);
    // Get session from memory first
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.log('IPC: session not found in memory:', sessionId);
      return [];
    }
    // Pass session to persistence manager
    const result = await persistenceManager.getArchivedConversationsForWorkingDir(session.workingDirectory);
    console.log('IPC: get-archived-conversations returning:', result);
    return result;
  });

  ipcMain.handle('session:load-archived-conversation', async (_, filename: string) => {
    return await persistenceManager.loadArchivedConversation(filename);
  });

  ipcMain.handle('session:get-archived-claude-session-id', async (_, filename: string) => {
    return await persistenceManager.getArchivedClaudeSessionId(filename);
  });

  ipcMain.handle('session:save-current-conversation', async (_, { sessionId, messages, claudeSessionId }) => {
    await persistenceManager.saveCurrentConversation(sessionId, messages, claudeSessionId);
  });

  // Claude communication
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (_, { sessionId, message, config }) => {
    return await sessionManager.sendMessage(sessionId, message, config);
  });

  ipcMain.handle(IPC_CHANNELS.STOP_PROCESS, async (_, sessionId: string) => {
    return sessionManager.stopSession(sessionId);
  });

  // Dialog
  ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async () => {
    if (!mainWindow) {return null;}

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Working Directory for New Session',
      buttonLabel: 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    return await persistenceManager.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (_, updates) => {
    await persistenceManager.updateSettings(updates);
  });

  // Permissions
  ipcMain.handle(IPC_CHANNELS.PERMISSION_RESPONSE, async (_, { requestId, allowed, alwaysAllow }) => {
    const pending = pendingPermissions.get(requestId);
    if (!pending) return null;

    pendingPermissions.delete(requestId);

    // If always allow, save to permissions.json for the session
    if (alwaysAllow && allowed) {
      await sessionManager.savePermissionForSession(
        pending.request.sessionId,
        pending.request.tool,
        pending.request.path
      );
      console.log('[PERMISSION] Saved always-allow to permissions.json');

      // Save the updated session with the new permission
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.id === pending.request.sessionId);
      if (session) {
        const messages = await persistenceManager.getSessionMessages(pending.request.sessionId);
        await persistenceManager.saveSession(session, messages);
      }
    }

    pending.resolve(allowed);

    // Return updated sessions so frontend can refresh
    return sessionManager.getAllSessions();
  });

  ipcMain.handle('session:remove-permission', async (_, { sessionId, index }) => {
    await sessionManager.removePermissionForSession(sessionId, index);

    // Save the updated session
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      const messages = await persistenceManager.getSessionMessages(sessionId);
      await persistenceManager.saveSession(session, messages);
    }

    // Return updated sessions
    return sessions;
  });

  // Window controls
  ipcMain.on(IPC_CHANNELS.MINIMIZE_WINDOW, () => {
    if (mainWindow) {mainWindow.minimize();}
  });

  ipcMain.on(IPC_CHANNELS.MAXIMIZE_WINDOW, () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.CLOSE_WINDOW, () => {
    if (mainWindow) {mainWindow.close();}
  });

  // Slash Commands
  ipcMain.handle(IPC_CHANNELS.GET_SLASH_COMMANDS, async (_, sessionId: string) => {
    // Get session from memory to retrieve working directory
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.log('Session not found:', sessionId);
      return [];
    }

    // Parse and return available slash commands (including built-in)
    return await SlashCommandParser.getAvailableCommands(session.workingDirectory, true);
  });

  // Agents
  ipcMain.handle(IPC_CHANNELS.GET_AGENTS, async (_, sessionId: string) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.log('Session not found:', sessionId);
      return [];
    }

    return await AgentParser.getAvailableAgents(session.workingDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.CREATE_AGENT, async (_, { sessionId, agent, scope }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await AgentParser.createAgent(session.workingDirectory, agent, scope);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_AGENT, async (_, agent) => {
    return await AgentParser.updateAgent(agent);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_AGENT, async (_, filePath: string) => {
    return await AgentParser.deleteAgent(filePath);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await initializeManagers();
  setupIPCHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  // Cleanup
  if (sessionManager) {
    sessionManager.cleanup();
  }
});