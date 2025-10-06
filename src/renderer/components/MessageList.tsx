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
  const messageListRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const previousMessageCountRef = useRef<number>(0);
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set());
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const { respondToPermission } = useSessionStore();

  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const isScrolledToBottom = () => {
    const container = messageListRef.current;
    if (!container) return true;

    const threshold = 150; // pixels from bottom to still consider "at bottom"
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    return isAtBottom;
  };

  // Track scroll position
  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    const handleScroll = () => {
      wasAtBottomRef.current = isScrolledToBottom();
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Handle auto-scroll when messages change
  useEffect(() => {
    const hasNewMessages = messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    // Always scroll to bottom if new messages were added
    if (hasNewMessages) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        scrollToBottom('auto');
        // Update the ref after scrolling
        wasAtBottomRef.current = true;
      });
    } else if (wasAtBottomRef.current) {
      // For content changes (collapse/expand), only scroll if already at bottom
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    }
  }, [messages, collapsedThinking, collapsedTools, expandedContent, expandedMessages]);

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

  const toggleMessageExpanded = (id: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedMessages(newExpanded);
  };

  const shouldTruncateContent = (content: string): boolean => {
    const lines = content.split('\n');
    return lines.length > 5;
  };

  const truncateContent = (content: string, maxLines: number = 5): string => {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n');
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

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMins = Math.floor(diffInMs / 60000);
    const diffInHours = Math.floor(diffInMs / 3600000);
    const diffInDays = Math.floor(diffInMs / 86400000);

    if (diffInMins < 1) return 'Just now';
    if (diffInMins < 60) return `${diffInMins}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInDays < 7) return `${diffInDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderMessage = (message: Message) => {
    const { type, content, metadata } = message;

    switch (type) {
      case 'user':
        return (
          <div key={message.id} className="message message-user">
            <div className="message-avatar">
              <div className="avatar-circle user-avatar">
                <span>You</span>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <span className="message-label">You</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(content, `user-${message.id}`)}
                  title="Copy message"
                >
                  {copiedCode === `user-${message.id}` ? '✓' : '📋'}
                </button>
              </div>
              <div className="message-content">
                <div className="message-text">{content}</div>
              </div>
            </div>
          </div>
        );

      case 'assistant':
        const isTruncatable = shouldTruncateContent(content);
        const isMessageExpanded = expandedMessages.has(message.id);
        const displayContent = isTruncatable && !isMessageExpanded ? truncateContent(content) : content;

        return (
          <div key={message.id} className="message message-claude">
            <div className="message-avatar">
              <div className="avatar-circle claude-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.6"/>
                  <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <span className="message-label">Claude</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                <button
                  className="copy-btn"
                  onClick={() => copyMessageContent(content, message.id)}
                  title="Copy message"
                >
                  {copiedCode === `msg-${message.id}` ? '✓' : '📋'}
                </button>
              </div>
              <div className="message-content">
                {MessageRenderer.renderEnhancedMarkdown(displayContent, message.id, renderConfig)}
                {isTruncatable && (
                  <button
                    className="expand-message-btn"
                    onClick={() => toggleMessageExpanded(message.id)}
                  >
                    {isMessageExpanded ? '▲ Show Less' : '▼ Show More'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      case 'thinking':
        const isThinkingCollapsed = collapsedThinking.has(message.id);
        return (
          <div key={message.id} className="message message-thinking">
            <div className="message-avatar">
              <div className="avatar-circle thinking-avatar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                  <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header" onClick={() => toggleThinking(message.id)} style={{ cursor: 'pointer' }}>
                <span className="message-label">Thinking</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                <span className="collapse-icon">
                  {isThinkingCollapsed ? '▶' : '▼'}
                </span>
              </div>
              {!isThinkingCollapsed && (
                <div className="message-content">
                  <div className="message-text">{content}</div>
                </div>
              )}
            </div>
          </div>
        );

      case 'tool':
        const toolName = metadata?.toolName || 'Tool';
        const displayName = formatToolName(toolName);
        const isToolCollapsed = collapsedTools.has(message.id);
        const hasContent = content && content.trim().length > 0;
        const isPending = metadata?.pendingPermission;
        const isDenied = metadata?.permissionDenied;

        return (
          <div key={message.id} className={`message message-tool ${isPending ? 'pending' : ''} ${isDenied ? 'denied' : ''}`}>
            <div className="message-avatar">
              <div className="avatar-circle tool-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div
                className="message-header"
                onClick={() => hasContent && toggleTool(message.id)}
                style={{ cursor: hasContent ? 'pointer' : 'default' }}
              >
                <span className="message-label">
                  {displayName}
                  {isPending && <span className="permission-badge">Awaiting Permission</span>}
                  {isDenied && <span className="permission-badge denied">Permission Denied</span>}
                </span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                {hasContent && (
                  <span className="collapse-icon">
                    {isToolCollapsed ? '▶' : '▼'}
                  </span>
                )}
              </div>
              {hasContent && !isToolCollapsed && (
                <div className="message-content">
                  {MessageRenderer.renderToolInput(toolName, content, message.id, renderConfig)}
                </div>
              )}
            </div>
          </div>
        );

      case 'tool-result':
        const isError = metadata?.isError || false;
        const isResultCollapsed = collapsedTools.has(message.id);
        const resultToolName = metadata?.toolName || 'Unknown';

        // Format tool result content
        const { formattedContent, isJson } = MessageRenderer.formatToolResultContent(content);

        // Check if content should be truncated
        const isResultTruncatable = shouldTruncateContent(formattedContent);
        const isResultExpanded = expandedMessages.has(`result-${message.id}`);
        const displayResultContent = isResultTruncatable && !isResultExpanded ? truncateContent(formattedContent) : formattedContent;

        return (
          <div
            key={message.id}
            className={`message message-tool-result ${isError ? 'error' : ''}`}
          >
            <div className="message-avatar">
              <div className={`avatar-circle ${isError ? 'error-avatar' : 'success-avatar'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  {isError ? (
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  ) : (
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  )}
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div
                className="message-header"
                onClick={() => toggleTool(message.id)}
                style={{ cursor: 'pointer' }}
              >
                <span className="message-label">
                  {isError ? 'Error' : 'Result'}
                </span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                <span className="collapse-icon">
                  {isResultCollapsed ? '▶' : '▼'}
                </span>
              </div>
              {!isResultCollapsed && (
                <div className="message-content">
                  {MessageRenderer.renderToolResult(displayResultContent, isJson, resultToolName, message.id, renderConfig)}
                  {isResultTruncatable && (
                    <button
                      className="expand-message-btn"
                      onClick={() => toggleMessageExpanded(`result-${message.id}`)}
                    >
                      {isResultExpanded ? '▲ Show Less' : '▼ Show More'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );

      case 'system':
        const isSystemTruncatable = shouldTruncateContent(content);
        const isSystemExpanded = expandedMessages.has(message.id);
        const displaySystemContent = isSystemTruncatable && !isSystemExpanded ? truncateContent(content) : content;

        return (
          <div key={message.id} className="message message-system">
            <div className="message-avatar">
              <div className="avatar-circle system-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <span className="message-label">System</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
              </div>
              <div className="message-content">
                <div className="message-text">{displaySystemContent}</div>
                {isSystemTruncatable && (
                  <button
                    className="expand-message-btn"
                    onClick={() => toggleMessageExpanded(message.id)}
                  >
                    {isSystemExpanded ? '▲ Show Less' : '▼ Show More'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      case 'error':
        const isErrorTruncatable = shouldTruncateContent(content);
        const isErrorExpanded = expandedMessages.has(message.id);
        const displayErrorContent = isErrorTruncatable && !isErrorExpanded ? truncateContent(content) : content;

        return (
          <div key={message.id} className="message message-error">
            <div className="message-avatar">
              <div className="avatar-circle error-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 9v4m0 4h.01M4.93 4.93l14.14 14.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <span className="message-label">Error</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(content, `error-${message.id}`)}
                  title="Copy error"
                >
                  {copiedCode === `error-${message.id}` ? '✓' : '📋'}
                </button>
              </div>
              <div className="message-content">
                <div className="message-text">{displayErrorContent}</div>
                {isErrorTruncatable && (
                  <button
                    className="expand-message-btn"
                    onClick={() => toggleMessageExpanded(message.id)}
                  >
                    {isErrorExpanded ? '▲ Show Less' : '▼ Show More'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      case 'permission-request':
        const permissionRequest = metadata?.permissionRequest;
        if (!permissionRequest) return null;

        const handlePermissionResponse = async (allowed: boolean, alwaysAllow: boolean, alwaysDeny?: boolean) => {
          await respondToPermission(permissionRequest.id, allowed, alwaysAllow, alwaysDeny);
        };

        return (
          <div key={message.id} className="message message-permission">
            <div className="message-avatar">
              <div className="avatar-circle permission-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <div className="message-bubble">
              <div className="message-header">
                <span className="message-label">Permission Required</span>
                <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
              </div>
              <div className="message-content">
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
                  Choose "Accept Always" or "Decline Always" to save this permission and skip future prompts.
                </p>
                <div className="permission-actions">
                  <button
                    className="btn outlined"
                    onClick={() => handlePermissionResponse(false, false)}
                  >
                    Deny Once
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => handlePermissionResponse(false, false, true)}
                  >
                    Decline Always
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
    <div className="message-list" ref={messageListRef}>
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