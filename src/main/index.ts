import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { MultiSessionManager } from './MultiSessionManager';
import { PersistenceManager } from './PersistenceManager';
import { SlashCommandParser } from './SlashCommandParser';
import { AgentParser } from './AgentParser';
import { MCPParser } from './MCPParser';
import { PermissionServer } from './PermissionServer';
import { CheckpointManager } from './CheckpointManager';
import { IPC_CHANNELS, PermissionRequest, FileItem } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let sessionManager: MultiSessionManager;
let persistenceManager: PersistenceManager;
let permissionServer: PermissionServer;
let checkpointManager: CheckpointManager;
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
      spellcheck: true, // Enable spell checking
    },
  });

  // Load the app
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Enable spell checker context menu
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { selectionText, misspelledWord, dictionarySuggestions, editFlags } = params;

    const menuTemplate: any[] = [];

    // If there's a misspelled word, show spell check options
    if (misspelledWord && dictionarySuggestions.length > 0) {
      menuTemplate.push({
        label: 'Suggestions',
        submenu: dictionarySuggestions.slice(0, 5).map(suggestion => ({
          label: suggestion,
          click: () => {
            mainWindow?.webContents.replaceMisspelling(suggestion);
          }
        }))
      });
      menuTemplate.push({
        label: 'Add to Dictionary',
        click: () => {
          mainWindow?.webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
        }
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Add standard editing options
    if (editFlags.canCut) {
      menuTemplate.push({
        label: 'Cut',
        role: 'cut'
      });
    }

    if (editFlags.canCopy) {
      menuTemplate.push({
        label: 'Copy',
        role: 'copy'
      });
    }

    if (editFlags.canPaste) {
      menuTemplate.push({
        label: 'Paste',
        role: 'paste'
      });
    }

    if (editFlags.canSelectAll) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: 'separator' });
      }
      menuTemplate.push({
        label: 'Select All',
        role: 'selectAll'
      });
    }

    // Only show context menu if there are items
    if (menuTemplate.length > 0) {
      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize managers
async function initializeManagers() {
  persistenceManager = new PersistenceManager();
  await persistenceManager.initialize();

  checkpointManager = new CheckpointManager();

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
async function handlePermissionRequest(sessionId: string, tool: string, filePath: string, message: string, input?: any): Promise<{ allowed: boolean; alwaysAllow?: boolean }> {
  console.log('[PERMISSION REQUEST]', { sessionId, tool, filePath, message, input });

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
    return { allowed: true, alwaysAllow: false };
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
      input, // Include tool input for proper permission formatting
    };

    console.log('[PERMISSION] Sending request to renderer:', requestId);
    pendingPermissions.set(requestId, { resolve: (allowed: boolean) => resolve({ allowed, alwaysAllow: false }), request });

    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.PERMISSION_REQUEST, request);
    } else {
      console.log('[PERMISSION] No main window, denying');
      resolve({ allowed: false, alwaysAllow: false });
    }
  });
}

// Set up IPC handlers
function setupIPCHandlers() {
  // Session management
  ipcMain.handle(IPC_CHANNELS.CREATE_SESSION, async (_, config) => {
    const session = await sessionManager.createSession(config);
    await sessionManager.loadSessionPermissions(session.id);
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

  ipcMain.handle(IPC_CHANNELS.SAVE_SESSION_MESSAGES, async (_, { sessionId, conversationId, messages, claudeSessionId }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      console.error('[IPC] Session not found:', sessionId);
      return;
    }

    // Update session's claudeSessionId if provided
    if (claudeSessionId !== undefined) {
      session.claudeSessionId = claudeSessionId;
    }

    // Save session metadata (includes messages.json for quick access)
    await persistenceManager.saveSession(session, messages);

    // If conversationId is provided, also save to history
    if (conversationId) {
      await persistenceManager.saveConversation(sessionId, conversationId, messages, session.claudeSessionId);
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

  ipcMain.handle('session:get-conversations', async (_, sessionId: string) => {
    return await persistenceManager.getConversations(sessionId);
  });

  ipcMain.handle('session:load-conversation', async (_, { sessionId, conversationId }) => {
    return await persistenceManager.loadConversation(sessionId, conversationId);
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
  ipcMain.handle(IPC_CHANNELS.PERMISSION_RESPONSE, async (_, { requestId, allowed, alwaysAllow, alwaysDeny }) => {
    const pending = pendingPermissions.get(requestId);
    if (!pending) return null;

    pendingPermissions.delete(requestId);

    // If always allow, save to allow list
    if (alwaysAllow && allowed) {
      await sessionManager.savePermissionForSession(
        pending.request.sessionId,
        pending.request.tool,
        pending.request.path,
        pending.request.input, // Pass tool input for proper permission formatting
        true // allow = true
      );
      console.log('[PERMISSION] Saved always-allow to settings.local.json');

      // Save the updated session with the new permission
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.id === pending.request.sessionId);
      if (session) {
        const messages = await persistenceManager.getSessionMessages(pending.request.sessionId) || [];
        await persistenceManager.saveSession(session, messages);
      }
    }

    // If always deny, save to deny list
    if (alwaysDeny && !allowed) {
      await sessionManager.saveDenyPermissionForSession(
        pending.request.sessionId,
        pending.request.tool,
        pending.request.path,
        pending.request.input // Pass tool input for proper permission formatting
      );
      console.log('[PERMISSION] Saved always-deny to settings.local.json');

      // Save the updated session with the new permission
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.id === pending.request.sessionId);
      if (session) {
        const messages = await persistenceManager.getSessionMessages(pending.request.sessionId) || [];
        await persistenceManager.saveSession(session, messages);
      }
    }

    // Resolve with allowed status
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
      const messages = await persistenceManager.getSessionMessages(sessionId) || [];
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

  // MCPs
  ipcMain.handle(IPC_CHANNELS.GET_MCPS, async (_, sessionId: string) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.log('Session not found:', sessionId);
      return [];
    }

    return await MCPParser.getAvailableMCPs(session.workingDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.CREATE_MCP, async (_, { sessionId, mcp, scope }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await MCPParser.createMCP(session.workingDirectory, mcp, scope);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_MCP, async (_, { sessionId, oldName, mcp }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await MCPParser.updateMCP(session.workingDirectory, oldName, mcp);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_MCP, async (_, { sessionId, name, scope }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await MCPParser.deleteMCP(session.workingDirectory, name, scope);
  });

  // Checkpoints
  ipcMain.handle(IPC_CHANNELS.CREATE_CHECKPOINT, async (_, { sessionId, message }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await checkpointManager.createCheckpoint(session.workingDirectory, message);
  });

  ipcMain.handle(IPC_CHANNELS.GET_CHECKPOINTS, async (_, sessionId: string) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.log('Session not found:', sessionId);
      return [];
    }

    return await checkpointManager.getCheckpoints(session.workingDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.RESTORE_CHECKPOINT, async (_, { sessionId, checkpointHash }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return await checkpointManager.restoreCheckpoint(session.workingDirectory, checkpointHash);
  });

  ipcMain.handle(IPC_CHANNELS.GET_CHECKPOINT_STATUS, async (_, sessionId: string) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      return { isGitRepo: false, hasChanges: false };
    }

    return await checkpointManager.getStatus(session.workingDirectory);
  });

  // File Operations
  ipcMain.handle(IPC_CHANNELS.LIST_FILES, async (_, { sessionId, relativePath }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const fullPath = relativePath
      ? path.join(session.workingDirectory, relativePath)
      : session.workingDirectory;

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files: FileItem[] = [];

      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);
        const relPath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;

        files.push({
          name: entry.name,
          path: relPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedTime: stats.mtime.toISOString(),
        });
      }

      // Sort: directories first, then files, alphabetically
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return files;
    } catch (error) {
      console.error('[LIST_FILES] Error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_FILE, async (_, { sessionId, relativePath }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const fullPath = path.join(session.workingDirectory, relativePath);

    // Safety check: ensure we're within the working directory
    if (!fullPath.startsWith(session.workingDirectory)) {
      throw new Error('Invalid path: must be within working directory');
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    } catch (error) {
      console.error('[DELETE_FILE] Error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_FILE, async (_, { sessionId, oldPath, newName }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const fullOldPath = path.join(session.workingDirectory, oldPath);
    const directory = path.dirname(fullOldPath);
    const fullNewPath = path.join(directory, newName);

    // Safety check
    if (!fullOldPath.startsWith(session.workingDirectory) || !fullNewPath.startsWith(session.workingDirectory)) {
      throw new Error('Invalid path: must be within working directory');
    }

    try {
      await fs.rename(fullOldPath, fullNewPath);
    } catch (error) {
      console.error('[RENAME_FILE] Error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.COPY_FILE, async (_, { sessionId, sourcePath, destPath }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const fullSourcePath = path.join(session.workingDirectory, sourcePath);
    const fullDestPath = path.join(session.workingDirectory, destPath);

    // Safety check
    if (!fullSourcePath.startsWith(session.workingDirectory) || !fullDestPath.startsWith(session.workingDirectory)) {
      throw new Error('Invalid path: must be within working directory');
    }

    try {
      const stats = await fs.stat(fullSourcePath);
      if (stats.isDirectory()) {
        await fs.cp(fullSourcePath, fullDestPath, { recursive: true });
      } else {
        await fs.copyFile(fullSourcePath, fullDestPath);
      }
    } catch (error) {
      console.error('[COPY_FILE] Error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CREATE_FOLDER, async (_, { sessionId, relativePath, folderName }) => {
    const sessions = sessionManager.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const parentPath = relativePath
      ? path.join(session.workingDirectory, relativePath)
      : session.workingDirectory;
    const fullPath = path.join(parentPath, folderName);

    // Safety check
    if (!fullPath.startsWith(session.workingDirectory)) {
      throw new Error('Invalid path: must be within working directory');
    }

    try {
      await fs.mkdir(fullPath, { recursive: false });
    } catch (error) {
      console.error('[CREATE_FOLDER] Error:', error);
      throw error;
    }
  });
}

// Map Claude session ID to our Electron session ID
function getSessionByClaudeId(claudeSessionId: string): string | null {
  const sessions = sessionManager.getAllSessions();
  const session = sessions.find(s => s.claudeSessionId === claudeSessionId);
  return session?.id || null;
}

// Get session working directory by session ID
function getSessionWorkingDir(sessionId: string): string | null {
  const sessions = sessionManager.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  return session?.workingDirectory || null;
}

// App lifecycle
app.whenReady().then(async () => {
  await initializeManagers();

  // Start permission server with session ID mapper and working directory getter
  permissionServer = new PermissionServer(8765, handlePermissionRequest, getSessionByClaudeId, getSessionWorkingDir);
  await permissionServer.start();

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

app.on('quit', async () => {
  // Cleanup
  if (sessionManager) {
    sessionManager.cleanup();
  }
  if (permissionServer) {
    await permissionServer.stop();
  }
});