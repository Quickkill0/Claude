import React, { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/types';
import { useSessionStore } from '../store/sessionStore';
import MessageList from './MessageList';
import HistoryModal from './HistoryModal';

interface ChatWindowProps {
  session: Session;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ session }) => {
  const { sendMessage, stopProcess, messages, getInputText, setInputText: setStoreInputText, startNewChat, updateSessionModel, loadArchivedConversation, loadedArchivedConversation, toggleThinkingMode } = useSessionStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const sessionMessages = messages.get(session.id) || [];
  const inputText = getInputText(session.id);
  const currentArchiveKey = loadedArchivedConversation.get(session.id);

  const setInputText = (text: string) => {
    setStoreInputText(session.id, text);
  };

  const handleSend = () => {
    if ((inputText.trim() || selectedFile) && !session.isProcessing) {
      let messageToSend = inputText.trim();

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

  const handleLoadConversation = async (filename: string) => {
    await loadArchivedConversation(session.id, filename);
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

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [inputText]);

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="session-info">
          <h3>{session.name}</h3>
        </div>
        <div className="session-actions">
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
            title={session.thinkingMode ? 'Extended thinking: ON' : 'Extended thinking: OFF'}
          >
            💭
          </button>
          <div className="button-bar-spacer"></div>
          <button
            className="btn-attach"
            onClick={handleFileSelect}
            disabled={session.isProcessing}
            title="Attach image"
          >
            📷
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
          sessionId={session.id}
          onClose={() => setShowHistory(false)}
          onLoadConversation={handleLoadConversation}
          currentArchiveKey={currentArchiveKey}
        />
      )}
    </div>
  );
};

export default ChatWindow;