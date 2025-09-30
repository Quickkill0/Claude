import React, { useEffect, useRef, useState } from 'react';
import type { Message } from '../../shared/types';
import { useSessionStore } from '../store/sessionStore';
import { MessageRenderer } from '../utils/messageRenderer';
import { formatToolName } from '../utils/messageFormatting';

interface MessageListProps {
  messages: Message[];
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set());
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());
  const { respondToPermission } = useSessionStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toggleThinking = (id: string) => {
    const newCollapsed = new Set(collapsedThinking);
    if (newCollapsed.has(id)) {
      newCollapsed.delete(id);
    } else {
      newCollapsed.add(id);
    }
    setCollapsedThinking(newCollapsed);
  };

  const toggleTool = (id: string) => {
    const newCollapsed = new Set(collapsedTools);
    if (newCollapsed.has(id)) {
      newCollapsed.delete(id);
    } else {
      newCollapsed.add(id);
    }
    setCollapsedTools(newCollapsed);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const copyMessageContent = async (content: string, id: string) => {
    // Remove markdown formatting for plain text copy
    const plainText = content
      .replace(/```[\s\S]*?```/g, (match) => {
        // Extract just the code without the backticks and language identifier
        const lines = match.split('\n');
        return lines.slice(1, -1).join('\n');
      })
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1');

    await copyToClipboard(plainText, `msg-${id}`);
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedContent);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedContent(newExpanded);
  };

  const openFile = async (path: string, lineNumber?: number) => {
    // For now, just copy the file path to clipboard
    // In a real implementation, this would use window.electronAPI.openFile
    try {
      await navigator.clipboard.writeText(lineNumber ? `${path}:${lineNumber}` : path);
      console.log(`File path copied: ${path}${lineNumber ? `:${lineNumber}` : ''}`);
    } catch (err) {
      console.error('Failed to copy file path:', err);
    }
  };

  // Create render config for MessageRenderer
  const renderConfig = {
    onCopyCode: copyToClipboard,
    onOpenFile: openFile,
    onToggleExpanded: toggleExpanded,
    copiedCode,
    expandedContent,
  };

  const renderMessage = (message: Message) => {
    const { type, content, metadata } = message;

    switch (type) {
      case 'user':
        return (
          <div key={message.id} className="message user">
            <div className="message-avatar">👤</div>
            <div className="message-content">
              <div className="message-header">
                <span className="message-sender">You</span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-body">
                <div className="message-text">{content}</div>
                <button
                  className="copy-button"
                  onClick={() => copyToClipboard(content, `user-${message.id}`)}
                  title="Copy message"
                >
                  {copiedCode === `user-${message.id}` ? '✓' : '📋'}
                </button>
              </div>
            </div>
          </div>
        );

      case 'assistant':
        return (
          <div key={message.id} className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="message-header">
                <span className="message-sender">Claude</span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-body">
                {MessageRenderer.renderEnhancedMarkdown(content, message.id, renderConfig)}
                <button
                  className="copy-button"
                  onClick={() => copyMessageContent(content, message.id)}
                  title="Copy message"
                >
                  {copiedCode === `msg-${message.id}` ? '✓' : '📋'}
                </button>
              </div>
            </div>
          </div>
        );

      case 'thinking':
        const isThinkingCollapsed = collapsedThinking.has(message.id);
        return (
          <div key={message.id} className="message thinking">
            <div
              className="thinking-header"
              onClick={() => toggleThinking(message.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="thinking-icon">
                <span className="collapse-icon">
                  {isThinkingCollapsed ? '▶' : '▼'}
                </span>
                💭
              </div>
              <div className="thinking-info">
                <span className="thinking-label">Thinking...</span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
            {!isThinkingCollapsed && (
              <div className="thinking-content">
                <div className="thinking-body">{content}</div>
              </div>
            )}
          </div>
        );

      case 'tool':
        const toolName = metadata?.toolName || 'Tool';
        const displayName = formatToolName(toolName);
        const isToolCollapsed = collapsedTools.has(message.id);
        const hasContent = content && content.trim().length > 0;

        return (
          <div key={message.id} className="message tool">
            <div
              className="tool-header"
              onClick={() => hasContent && toggleTool(message.id)}
              style={{ cursor: hasContent ? 'pointer' : 'default' }}
            >
              <div className="tool-icon-wrapper">
                {hasContent && (
                  <span className="collapse-icon">
                    {isToolCollapsed ? '▶' : '▼'}
                  </span>
                )}
                <div className="tool-icon">🔧</div>
              </div>
              <div className="tool-info">{displayName}</div>
            </div>
            {hasContent && !isToolCollapsed && (
              <div className="tool-body">
                {MessageRenderer.renderToolInput(toolName, content, message.id, renderConfig)}
              </div>
            )}
          </div>
        );

      case 'tool-result':
        const isError = metadata?.isError || false;
        const isResultCollapsed = collapsedTools.has(message.id);
        const resultToolName = metadata?.toolName || 'Unknown';

        // Format tool result content
        const { formattedContent, isJson } = MessageRenderer.formatToolResultContent(content);

        return (
          <div
            key={message.id}
            className={`message tool-result ${isError ? 'error' : ''}`}
          >
            <div
              className="tool-result-header"
              onClick={() => toggleTool(message.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="tool-result-icon-wrapper">
                <span className="collapse-icon">
                  {isResultCollapsed ? '▶' : '▼'}
                </span>
                <div className={`message-icon ${isError ? 'error' : 'success'}`}>
                  {isError ? '❌' : '✅'}
                </div>
              </div>
              <div className="tool-result-info">
                <span className="message-label">
                  {isError ? 'Error' : 'Result'}: {resultToolName}
                </span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
            {!isResultCollapsed && (
              <div className="tool-result-body">
                {MessageRenderer.renderToolResult(formattedContent, isJson)}
              </div>
            )}
          </div>
        );

      case 'system':
        return (
          <div key={message.id} className="message system">
            <div className="message-avatar">ℹ️</div>
            <div className="message-content">
              <div className="message-body">{content}</div>
            </div>
          </div>
        );

      case 'error':
        return (
          <div key={message.id} className="message error">
            <div className="message-avatar">⚠️</div>
            <div className="message-content">
              <div className="message-header">
                <span className="message-sender">Error</span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-body error-body">
                {content}
              </div>
            </div>
          </div>
        );

      case 'permission-request':
        const permissionRequest = metadata?.permissionRequest;
        if (!permissionRequest) return null;

        const handlePermissionResponse = async (allowed: boolean, alwaysAllow: boolean) => {
          await respondToPermission(permissionRequest.id, allowed, alwaysAllow);
        };

        return (
          <div key={message.id} className="message permission-request">
            <div className="message-avatar">🔐</div>
            <div className="message-content">
              <div className="message-header">
                <span className="message-sender">Permission Required</span>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-body">
                <div className="permission-message">{content}</div>
                <div className="permission-details">
                  <div className="detail-row">
                    <span className="detail-label">Tool:</span>
                    <span className="detail-value">{permissionRequest.tool}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Path:</span>
                    <span className="detail-value path">{permissionRequest.path}</span>
                  </div>
                </div>
                <p className="permission-hint">
                  Choose "Accept Always" to save this permission and skip future prompts for this tool.
                </p>
                <div className="permission-actions">
                  <button
                    className="btn outlined"
                    onClick={() => handlePermissionResponse(false, false)}
                  >
                    Deny
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => handlePermissionResponse(true, false)}
                  >
                    Accept Once
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => handlePermissionResponse(true, true)}
                  >
                    Accept Always
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="message-list">
      {messages.length === 0 ? (
        <div className="empty-state">
          <h2>Start a conversation with Claude</h2>
          <p>Type your message below to get started</p>
        </div>
      ) : (
        messages.map((message) => renderMessage(message))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;