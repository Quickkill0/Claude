import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import { MultiSessionManager } from './MultiSessionManager';
import { PersistenceManager } from './PersistenceManager';
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

  // Load persisted sessions
  const { sessions, messagesMap } = await persistenceManager.loadSessions();
  sessionManager.restoreSessions(sessions, messagesMap);
}

// Handle permission request
async function handlePermissionRequest(sessionId: string, tool: string, filePath: string, message: string): Promise<boolean> {
  // Check always-allow permissions first
  const settings = await persistenceManager.getSettings();
  const isAllowed = settings.alwaysAllowPermissions.some(rule => {
    if (rule.tool !== tool) return false;
    if (rule.path && rule.path === filePath) return true;
    if (rule.pattern && new RegExp(rule.pattern).test(filePath)) return true;
    return false;
  });

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

    pendingPermissions.set(requestId, { resolve, request });

    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.PERMISSION_REQUEST, request);
    } else {
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
    const result = await sessionManager.deleteSession(sessionId);
    await persistenceManager.deleteSession(sessionId);
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
      // Normal session save
      console.log('SAVE_SESSION_MESSAGES - saving as session');
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        await persistenceManager.saveSession(session, messages);
      }
    }
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
    if (!pending) return;

    pendingPermissions.delete(requestId);

    // If always allow, save to settings
    if (alwaysAllow && allowed) {
      const settings = await persistenceManager.getSettings();
      settings.alwaysAllowPermissions.push({
        tool: pending.request.tool,
        path: pending.request.path,
        allowed: true,
        createdAt: new Date().toISOString(),
      });
      await persistenceManager.updateSettings({ alwaysAllowPermissions: settings.alwaysAllowPermissions });
    }

    pending.resolve(allowed);
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