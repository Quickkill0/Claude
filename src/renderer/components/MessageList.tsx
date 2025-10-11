import React, { useEffect, useRef, useState } from 'react';
import type { Message, AppSettings } from '../../shared/types';
import { useSessionStore } from '../store/sessionStore';
import { MessageRenderer } from '../utils/messageRenderer';
import { formatToolName } from '../utils/messageFormatting';
import ToolSummaryCard from './ToolSummaryCard';
import { groupToolMessages, type ToolGroup } from '../utils/toolGrouping';

interface MessageListProps {
  messages: Message[];
  onToolSummaryClick?: (messageId: string) => void;
  onOpenFile?: (filePath: string, lineNumber?: number) => void;
}

const MessageList: React.FC<MessageListProps> = ({ messages, onToolSummaryClick, onOpenFile }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const previousMessageCountRef = useRef<number>(0);
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set());
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activityPanelMessageId, setActivityPanelMessageId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const { respondToPermission } = useSessionStore();

  useEffect(() => {
    const loadSettings = async () => {
      const appSettings = await window.electronAPI.getSettings();
      setSettings(appSettings);
    };
    loadSettings();

    // Add interval to check for settings changes every 500ms
    const settingsInterval = setInterval(loadSettings, 500);
    return () => clearInterval(settingsInterval);
  }, []);

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

  // Create render config for MessageRenderer
  const renderConfig = {
    onCopyCode: copyToClipboard,
    onOpenFile: onOpenFile || (() => {}), // Use the callback from props, or no-op if not provided
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

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const renderToolGroup = (group: ToolGroup) => {
    const isExpanded = expandedGroups.has(group.id);
    const messageDensity = settings?.messageDensity || 'balanced';

    // In minimal mode, don't show tool groups
    if (messageDensity === 'minimal') {
      return null;
    }

    // In balanced mode, show compact group summary
    if (messageDensity === 'balanced' && group.type === 'operation') {
      return (
        <div key={group.id} className="message message-tool-group">
          <div className="tool-group-summary" onClick={() => toggleGroup(group.id)}>
            <span className="tool-group-icon">{group.icon}</span>
            <span className="tool-group-text">{group.summary}</span>
            <span className="tool-group-count">{group.messages.length} steps</span>
            <span className="tool-group-expand">{isExpanded ? '▼' : '▶'}</span>
          </div>
          {isExpanded && (
            <div className="tool-group-details">
              {/* In balanced mode, show clickable cards so users can jump to Activity Panel */}
              {group.messages.map((msg) => renderMessage(msg, false))}
            </div>
          )}
        </div>
      );
    }

    // For detailed mode, render individual messages with full details
    return group.messages.map((msg) => renderMessage(msg, messageDensity === 'detailed'));
  };

  const renderMessage = (message: Message, forceDetailed: boolean = false) => {
    const { type, content, metadata } = message;

    // Override density if rendering inside a group
    const effectiveDensity = forceDetailed ? 'detailed' : (settings?.messageDensity || 'balanced');

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

      case 'tool': {
        // In minimal mode, don't show tools in main chat
        if (effectiveDensity === 'minimal') {
          return null;
        }

        // In balanced mode, show compact summary card
        if (effectiveDensity === 'balanced') {
          return (
            <div key={message.id} className="message message-tool-summary">
              <ToolSummaryCard
                message={message}
                onClick={() => {
                  setActivityPanelMessageId(message.id);
                  onToolSummaryClick?.(message.id);
                }}
              />
            </div>
          );
        }

        // In detailed mode, show full tool message (existing code)
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
      }

      case 'tool-result': {
        // In minimal mode, don't show results in main chat
        if (effectiveDensity === 'minimal') {
          return null;
        }

        // In balanced mode, show compact summary card
        if (effectiveDensity === 'balanced') {
          return (
            <div key={message.id} className="message message-tool-summary">
              <ToolSummaryCard
                message={message}
                onClick={() => {
                  setActivityPanelMessageId(message.id);
                  onToolSummaryClick?.(message.id);
                }}
              />
            </div>
          );
        }

        // In detailed mode, show full result (existing code)
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
      }

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

  // Group tool messages if enabled (balanced mode with operations)
  const shouldGroupTools = settings?.messageDensity === 'balanced';
  const toolGroups = shouldGroupTools ? groupToolMessages(messages) : [];
  const groupedMessageIds = new Set(toolGroups.flatMap(g => g.messages.map(m => m.id)));

  return (
    <div className="message-list" ref={messageListRef}>
      {messages.length === 0 ? (
        <div className="empty-state">
          <h2>Start a conversation with Claude</h2>
          <p>Type your message below to get started</p>
        </div>
      ) : shouldGroupTools ? (
        // Render with grouping logic
        messages.map((message) => {
          // Find if this message is part of a group
          const group = toolGroups.find(g => g.messages[0].id === message.id);

          // If this is the first message of a group, render the whole group
          if (group && group.messages[0].id === message.id) {
            return renderToolGroup(group);
          }

          // If this message is in a group but not the first, skip (already rendered)
          if (groupedMessageIds.has(message.id)) {
            return null;
          }

          // Otherwise render individual message
          return renderMessage(message);
        })
      ) : (
        // Render without grouping
        messages.map((message) => renderMessage(message))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;