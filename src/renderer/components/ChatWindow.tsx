import React, { useEffect, useRef, useState } from 'react';
import type { Session, SlashCommand } from '../../shared/types';
import { useSessionStore } from '../store/sessionStore';
import MessageList from './MessageList';
import HistoryModal from './HistoryModal';
import RestoreModal from './RestoreModal';
import SlashCommandAutocomplete from './SlashCommandAutocomplete';
import AgentManagementModal from './AgentManagementModal';
import { CommandHandler } from '../utils/commandHandler';

// Crypto for generating UUIDs
const crypto = window.crypto;

interface ChatWindowProps {
  session: Session;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ session }) => {
  const { sendMessage, stopProcess, messages, getInputText, setInputText: setStoreInputText, startNewChat, updateSessionModel, loadConversation, toggleThinkingMode, togglePlanMode } = useSessionStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreKey, setRestoreKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 });
  const [showAgentModal, setShowAgentModal] = useState(false);

  const sessionMessages = messages.get(session.id) || [];
  const inputText = getInputText(session.id);

  const setInputText = (text: string) => {
    setStoreInputText(session.id, text);

    // Check if we should show autocomplete
    const cursorPosition = inputRef.current?.selectionStart || 0;
    const textBeforeCursor = text.substring(0, cursorPosition);

    // Match slash command pattern: /command or start of line with /
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/);

    if (slashMatch && slashCommands.length > 0) {
      const query = slashMatch[1];
      setAutocompleteQuery(query);
      setShowAutocomplete(true);

      // Calculate autocomplete position
      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect();
        setAutocompletePosition({
          top: rect.top - 400, // Show above the input
          left: rect.left,
        });
      }
    } else {
      setShowAutocomplete(false);
    }
  };

  const handleSend = () => {
    if ((inputText.trim() || selectedFile) && !session.isProcessing) {
      let messageToSend = inputText.trim();

      // Check for built-in commands first
      const builtInResult = handleBuiltInCommands(messageToSend);
      if (builtInResult.handled) {
        setInputText('');
        setSelectedFile(null);
        return;
      }

      // Expand custom slash commands before sending
      messageToSend = expandSlashCommands(messageToSend);

      // Append file path to message if a file is selected
      if (selectedFile) {
        messageToSend = messageToSend
          ? `${messageToSend}\n\n[Image: ${selectedFile}]`
          : `[Image: ${selectedFile}]`;
      }

      sendMessage(session.id, messageToSend);
      setInputText('');
      setSelectedFile(null);
    }
  };

  // Handle built-in commands via UI actions
  const handleBuiltInCommands = (text: string): { handled: boolean } => {
    // Match slash command pattern at start of message
    const commandMatch = text.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!commandMatch) {
      return { handled: false };
    }

    const commandName = commandMatch[1];
    const argsString = commandMatch[2] || '';
    const args = argsString.trim() ? argsString.trim().split(/\s+/) : [];

    // Check if this is a built-in command
    const command = slashCommands.find(cmd => cmd.name === commandName && cmd.source === 'builtin');
    if (!command) {
      return { handled: false };
    }

    // Get command action
    const action = CommandHandler.getCommandAction(commandName, args);

    // Handle the action
    switch (action.type) {
      case 'ui-action':
        executeUIAction(action);
        break;
      case 'open-modal':
        if (action.modal === 'agents') {
          setShowAgentModal(true);
        }
        break;
      case 'not-supported':
        // Show info message
        const infoMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'system' as const,
          content: action.message || 'Command not supported in UI',
        };
        useSessionStore.getState().addMessage(session.id, infoMessage);
        break;
    }

    return { handled: true };
  };

  // Execute UI action based on command
  const executeUIAction = (action: any) => {
    switch (action.action) {
      case 'clear-conversation':
        startNewChat(session.id);
        break;
      case 'change-model':
        updateSessionModel(session.id, action.data.model);
        break;
      case 'show-model-selector':
      case 'show-cost':
      case 'show-status':
        // Show info message
        const infoMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'system' as const,
          content: action.message,
        };
        useSessionStore.getState().addMessage(session.id, infoMessage);
        break;
      case 'open-settings':
        // TODO: Trigger settings modal (needs parent component integration)
        const settingsMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'system' as const,
          content: 'Settings can be accessed from the title bar menu',
        };
        useSessionStore.getState().addMessage(session.id, settingsMessage);
        break;
      case 'show-permissions':
        // TODO: Trigger permissions modal
        const permissionsMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'system' as const,
          content: 'Permissions can be managed in session settings',
        };
        useSessionStore.getState().addMessage(session.id, permissionsMessage);
        break;
      case 'show-help':
        const helpMessage = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'system' as const,
          content: action.message,
        };
        useSessionStore.getState().addMessage(session.id, helpMessage);
        break;
    }
  };

  // Expand slash commands in the message
  const expandSlashCommands = (text: string): string => {
    let expanded = text;

    // Match slash commands: /command arg1 arg2 arg3
    const commandRegex = /\/(\w+)(?:\s+(.+?))?(?=\s*\/\w+|\s*$)/g;
    const matches = Array.from(text.matchAll(commandRegex));

    // Process matches in reverse order to maintain string indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const commandName = match[1];
      const argsString = match[2] || '';
      const args = argsString.trim() ? argsString.trim().split(/\s+/) : [];

      // Find the command in our list
      const command = slashCommands.find(cmd => cmd.name === commandName);

      if (command) {
        // Built-in commands: pass through as-is (they're handled by Claude Code)
        if (command.source === 'builtin') {
          // Keep the command as-is, no expansion needed
          continue;
        }

        // Custom commands: expand with arguments
        let commandContent = command.content;

        // Replace $ARGUMENTS with all arguments joined by space
        const allArgs = args.join(' ');
        commandContent = commandContent.replace(/\$ARGUMENTS/g, allArgs);

        // Replace $1, $2, $3, etc. with individual arguments
        args.forEach((arg, index) => {
          const placeholder = new RegExp(`\\$${index + 1}`, 'g');
          commandContent = commandContent.replace(placeholder, arg);
        });

        // Replace the slash command with expanded content
        expanded = expanded.substring(0, match.index!) + commandContent + expanded.substring(match.index! + match[0].length);
      }
    }

    return expanded;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    stopProcess(session.id);
  };

  const handleNewChat = () => {
    startNewChat(session.id);
  };

  const handleShowHistory = () => {
    setHistoryKey(prev => prev + 1); // Force remount to refresh data
    setShowHistory(true);
  };

  const handleShowRestore = () => {
    setRestoreKey(prev => prev + 1); // Force remount to refresh data
    setShowRestore(true);
  };

  const handleLoadConversation = async (conversationId: string) => {
    await loadConversation(session.id, conversationId);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value as 'opus' | 'sonnet' | 'sonnet1m' | 'default';
    updateSessionModel(session.id, newModel);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Get the full path - note: in browser this will only give filename
      // In Electron, we need to use a different approach to get full path
      const path = (file as any).path || file.name;
      setSelectedFile(path);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleToggleThinking = () => {
    toggleThinkingMode(session.id);
  };

  const handleTogglePlan = () => {
    togglePlanMode(session.id);
  };

  // Load slash commands when session changes
  useEffect(() => {
    const loadCommands = async () => {
      try {
        const commands = await window.electronAPI.getSlashCommands(session.id);
        setSlashCommands(commands);
      } catch (error) {
        console.error('Error loading slash commands:', error);
      }
    };

    loadCommands();
  }, [session.id]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [inputText]);

  // Handle slash command selection
  const handleCommandSelect = (command: SlashCommand) => {
    const cursorPosition = inputRef.current?.selectionStart || 0;
    const textBeforeCursor = inputText.substring(0, cursorPosition);
    const textAfterCursor = inputText.substring(cursorPosition);

    // Find the slash command pattern and replace it
    const slashMatch = textBeforeCursor.match(/((?:^|\s)\/\w*)$/);

    if (slashMatch) {
      const beforeSlash = textBeforeCursor.substring(0, textBeforeCursor.length - slashMatch[1].length);
      const newText = beforeSlash + (beforeSlash && !beforeSlash.endsWith(' ') ? ' ' : '') + `/${command.name} ` + textAfterCursor;
      setInputText(newText);

      // Focus back on input and position cursor after the command
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = beforeSlash.length + (beforeSlash && !beforeSlash.endsWith(' ') ? 1 : 0) + command.name.length + 2;
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    }

    setShowAutocomplete(false);
  };

  const handleCloseAutocomplete = () => {
    setShowAutocomplete(false);
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="session-info">
          <h3>{session.name}</h3>
        </div>
        <div className="session-actions">
          <button className="btn outlined small" onClick={handleShowRestore} title="Restore from checkpoint">
            🔖 Restore
          </button>
          <button className="btn outlined small" onClick={handleShowHistory} title="View conversation history">
            📜 History
          </button>
          <button className="btn outlined small" onClick={handleNewChat} title="Start new conversation">
            ➕ New Chat
          </button>
        </div>
      </div>

      <MessageList messages={sessionMessages} />

      <div className="chat-input">
        <div className="status-bar-top">
          <div className="status-indicator">
            <span className={`status-dot ${session.isProcessing ? 'processing' : 'ready'}`}></span>
            <span className="status-text">{session.isProcessing ? 'Processing' : 'Ready'}</span>
            <span className="status-separator">•</span>
            <span className="status-cost">
              ${(session.totalCost || 0).toFixed(4)} • {((session.tokenUsage?.inputTokens || 0) + (session.tokenUsage?.outputTokens || 0)).toLocaleString()} tokens
              {session.tokenUsage && (session.tokenUsage.cacheCreationTokens > 0 || session.tokenUsage.cacheReadTokens > 0) && (
                <span className="cache-info" title={`Cache: ${session.tokenUsage.cacheCreationTokens.toLocaleString()} created, ${session.tokenUsage.cacheReadTokens.toLocaleString()} read`}>
                  {' '}(📦 {(session.tokenUsage.cacheCreationTokens + session.tokenUsage.cacheReadTokens).toLocaleString()})
                </span>
              )}
            </span>
          </div>
          {session.isProcessing && (
            <button className="btn-stop-status" onClick={handleStop} title="Stop processing">
              Stop
            </button>
          )}
        </div>

        {selectedFile && (
          <div className="file-attachment-area">
            <div className="file-chip">
              <span className="file-icon">🖼️</span>
              <span className="file-name">{selectedFile.split(/[\\/]/).pop()}</span>
              <button
                className="remove-file-btn"
                onClick={handleRemoveFile}
                title="Remove file"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={inputRef}
          className="input-field"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message to Claude Code..."
          disabled={session.isProcessing}
          rows={1}
          spellCheck={true}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        <div className="button-bar">
          <button
            className={`btn-thinking-toggle ${session.thinkingMode ? 'active' : ''}`}
            onClick={handleToggleThinking}
            disabled={session.isProcessing}
            title={session.thinkingMode ? 'Show reasoning: ON' : 'Show reasoning: OFF'}
          >
            💭
          </button>
          <button
            className={`btn-plan-toggle ${session.planMode ? 'active' : ''}`}
            onClick={handleTogglePlan}
            disabled={session.isProcessing}
            title={session.planMode ? 'Plan mode: ON' : 'Plan mode: OFF'}
          >
            📋
          </button>
          <div className="button-bar-spacer"></div>
          <button
            className="btn-attach"
            onClick={handleFileSelect}
            disabled={session.isProcessing}
            title="Attach image"
          >
            🖼️
          </button>
          <button
            className="btn-send"
            onClick={handleSend}
            disabled={session.isProcessing || (!inputText.trim() && !selectedFile)}
            title="Send message (Enter)"
          >
            Send ↵
          </button>
        </div>
      </div>

      {showHistory && (
        <HistoryModal
          key={historyKey}
          session={session}
          onClose={() => setShowHistory(false)}
          onLoadConversation={handleLoadConversation}
        />
      )}

      {showRestore && (
        <RestoreModal
          key={restoreKey}
          session={session}
          onClose={() => setShowRestore(false)}
        />
      )}

      {showAutocomplete && (
        <SlashCommandAutocomplete
          commands={slashCommands}
          query={autocompleteQuery}
          onSelect={handleCommandSelect}
          onClose={handleCloseAutocomplete}
          position={autocompletePosition}
        />
      )}

      {showAgentModal && (
        <AgentManagementModal
          sessionId={session.id}
          onClose={() => setShowAgentModal(false)}
        />
      )}
    </div>
  );
};

export default ChatWindow;