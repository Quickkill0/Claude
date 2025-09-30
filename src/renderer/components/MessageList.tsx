import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../../shared/types';
import { useSessionStore } from '../store/sessionStore';
import {
  extractFileReferences,
  parseTodoWrite,
  getTodoStatusIcon,
  parseEditTool,
  parseWriteTool,
  parseReadTool,
  truncateContent,
  formatDiffLines,
  getFileIcon,
  getFileName,
  normalizePath,
  formatToolName,
} from '../utils/messageFormatting';

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

  // Render a file path button
  const renderFilePathButton = (path: string, lineNumber?: number, size: 'small' | 'medium' = 'medium') => {
    const fileName = getFileName(path);
    const icon = getFileIcon(path);

    return (
      <button
        className={`file-path-button ${size}`}
        onClick={() => openFile(path, lineNumber)}
        title={`Click to copy: ${normalizePath(path)}${lineNumber ? `:${lineNumber}` : ''}`}
      >
        <span className="file-icon">{icon}</span>
        <span className="file-name">{fileName}</span>
        {lineNumber && <span className="file-line">:{lineNumber}</span>}
      </button>
    );
  };

  // Render TodoWrite content
  const renderTodoWrite = (content: string, messageId: string) => {
    const todos = parseTodoWrite(content);

    if (!todos) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    return (
      <div className="todo-list">
        {todos.map((todo, index) => (
          <div key={index} className={`todo-item ${todo.status}`}>
            <span className="todo-status">{getTodoStatusIcon(todo.status)}</span>
            <div className="todo-content">
              <div className="todo-text">{todo.content}</div>
              {todo.status === 'in_progress' && (
                <div className="todo-active">{todo.activeForm}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render Edit tool content with diff view
  const renderEditTool = (content: string, messageId: string) => {
    const editData = parseEditTool(content);

    if (!editData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, old_string, new_string, replace_all } = editData;
    const { oldLines, newLines } = formatDiffLines(old_string, new_string);

    return (
      <div className="edit-tool-content">
        <div className="edit-file-path">
          {renderFilePathButton(file_path)}
          {replace_all && <span className="edit-badge">Replace All</span>}
        </div>
        <div className="diff-view">
          <div className="diff-section removed">
            <div className="diff-header">Removed</div>
            <pre className="diff-content">
              {oldLines.join('\n')}
            </pre>
          </div>
          <div className="diff-section added">
            <div className="diff-header">Added</div>
            <pre className="diff-content">
              {newLines.join('\n')}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  // Render Write tool content
  const renderWriteTool = (content: string, messageId: string) => {
    const writeData = parseWriteTool(content);

    if (!writeData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, content: fileContent } = writeData;
    const { truncated, isTruncated, totalLines } = truncateContent(fileContent, 10);
    const isExpanded = expandedContent.has(`write-${messageId}`);
    const displayContent = isExpanded ? fileContent : truncated;

    return (
      <div className="write-tool-content">
        <div className="write-file-path">
          {renderFilePathButton(file_path)}
          <span className="write-lines">{totalLines} lines</span>
        </div>
        <div className="write-preview">
          <SyntaxHighlighter
            style={vscDarkPlus}
            language="text"
            showLineNumbers
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '4px', fontSize: '12px' }}
          >
            {displayContent}
          </SyntaxHighlighter>
        </div>
        {isTruncated && (
          <button
            className="expand-button"
            onClick={() => toggleExpanded(`write-${messageId}`)}
          >
            {isExpanded ? 'Show Less' : `Show More (${totalLines - 10} more lines)`}
          </button>
        )}
      </div>
    );
  };

  // Render Read tool content
  const renderReadTool = (content: string, messageId: string) => {
    const readData = parseReadTool(content);

    if (!readData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, offset, limit } = readData;

    return (
      <div className="read-tool-content">
        {renderFilePathButton(file_path)}
        {(offset !== undefined || limit !== undefined) && (
          <div className="read-params">
            {offset !== undefined && <span className="param">Offset: {offset}</span>}
            {limit !== undefined && <span className="param">Limit: {limit}</span>}
          </div>
        )}
      </div>
    );
  };

  // Render tool input based on tool type
  const renderToolInput = (toolName: string, content: string, messageId: string) => {
    switch (toolName) {
      case 'TodoWrite':
        return renderTodoWrite(content, messageId);
      case 'Edit':
        return renderEditTool(content, messageId);
      case 'Write':
        return renderWriteTool(content, messageId);
      case 'Read':
        return renderReadTool(content, messageId);
      default:
        // Check if content contains file_path and render it
        try {
          const parsed = JSON.parse(content);
          if (parsed.file_path) {
            return (
              <div className="generic-tool-content">
                {renderFilePathButton(parsed.file_path)}
                <pre className="tool-input-content">{content}</pre>
              </div>
            );
          }
        } catch (e) {
          // Not JSON, render as is
        }
        return <pre className="tool-input-content">{content}</pre>;
    }
  };

  // Enhanced markdown renderer with file path detection
  const renderEnhancedMarkdown = (content: string, messageId: string) => {
    const fileRefs = extractFileReferences(content);

    return (
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            const codeId = `code-${messageId}-${Math.random()}`;

            return !inline && match ? (
              <div className="code-block-wrapper">
                <div className="code-block-header">
                  <span className="code-language">{match[1]}</span>
                  <button
                    className="copy-code-button"
                    onClick={() => copyToClipboard(codeString, codeId)}
                    title="Copy code"
                  >
                    {copiedCode === codeId ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  {...props}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          p({ children }) {
            // Check if paragraph contains file references
            const text = String(children);
            const refs = extractFileReferences(text);

            if (refs.length > 0) {
              // Render with file chips
              return (
                <p className="text-with-files">
                  {children}
                  <div className="file-chips">
                    {refs.map((ref, idx) => (
                      <button
                        key={idx}
                        className="file-chip"
                        onClick={() => openFile(ref.path, ref.lineNumber)}
                        title={normalizePath(ref.path)}
                      >
                        <span className="file-icon">{getFileIcon(ref.path)}</span>
                        <span className="file-name">{getFileName(ref.path)}</span>
                        {ref.lineNumber && <span className="file-line">:{ref.lineNumber}</span>}
                      </button>
                    ))}
                  </div>
                </p>
              );
            }

            return <p>{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
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
                {renderEnhancedMarkdown(content, message.id)}
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
                {renderToolInput(toolName, content, message.id)}
              </div>
            )}
          </div>
        );

      case 'tool-result':
        const isError = metadata?.isError || false;
        const isResultCollapsed = collapsedTools.has(message.id);
        const resultToolName = metadata?.toolName || 'Unknown';

        // Try to parse and format JSON content
        let formattedContent = content;
        let isJson = false;
        try {
          const parsed = JSON.parse(content);
          formattedContent = JSON.stringify(parsed, null, 2);
          isJson = true;
        } catch {
          // Not JSON, use as is
        }

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
                {isJson ? (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language="json"
                    PreTag="div"
                    customStyle={{ margin: 0, borderRadius: '4px' }}
                  >
                    {formattedContent}
                  </SyntaxHighlighter>
                ) : (
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{ margin: 0 }}
                            {...props}
                          >
                            {codeString}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {formattedContent}
                  </ReactMarkdown>
                )}
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