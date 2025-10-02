/**
 * MessageRenderer - Centralized rendering utilities for messages
 * Handles all message rendering logic for different message and content types
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../../shared/types';
import {
  extractFileReferences,
  parseTodoWrite,
  getTodoStatusIcon,
  parseEditTool,
  parseWriteTool,
  parseReadTool,
  parseExitPlanMode,
  truncateContent,
  formatDiffLines,
  getFileIcon,
  getFileName,
  normalizePath,
  formatToolName,
} from './messageFormatting';

export interface RenderConfig {
  onCopyCode?: (text: string, id: string) => void;
  onOpenFile?: (path: string, lineNumber?: number) => void;
  onToggleExpanded?: (id: string) => void;
  copiedCode?: string | null;
  expandedContent?: Set<string>;
}

export class MessageRenderer {
  /**
   * Render a file path button
   */
  static renderFilePathButton(
    path: string,
    lineNumber?: number,
    size: 'small' | 'medium' = 'medium',
    onOpenFile?: (path: string, lineNumber?: number) => void
  ): JSX.Element {
    const fileName = getFileName(path);
    const icon = getFileIcon(path);

    return (
      <button
        className={`file-path-button ${size}`}
        onClick={() => onOpenFile?.(path, lineNumber)}
        title={`Click to copy: ${normalizePath(path)}${lineNumber ? `:${lineNumber}` : ''}`}
      >
        <span className="file-icon">{icon}</span>
        <span className="file-name">{fileName}</span>
        {lineNumber && <span className="file-line">:{lineNumber}</span>}
      </button>
    );
  }

  /**
   * Render TodoWrite content
   */
  static renderTodoWrite(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
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
  }

  /**
   * Render Edit tool content with diff view
   */
  static renderEditTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    const editData = parseEditTool(content);

    if (!editData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, old_string, new_string, replace_all } = editData;
    const { oldLines, newLines } = formatDiffLines(old_string, new_string);

    return (
      <div className="edit-tool-content">
        <div className="edit-file-path">
          {this.renderFilePathButton(file_path, undefined, 'medium', config.onOpenFile)}
          {replace_all && <span className="edit-badge">Replace All</span>}
        </div>
        <div className="diff-view">
          <div className="diff-section removed">
            <div className="diff-header">
              <span>Removed</span>
              <button
                className="copy-code-button"
                onClick={() => config.onCopyCode?.(old_string, `edit-old-${messageId}`)}
                title="Copy removed code"
              >
                {config.copiedCode === `edit-old-${messageId}` ? '✓' : '📋'}
              </button>
            </div>
            <pre className="diff-content">{oldLines.join('\n')}</pre>
          </div>
          <div className="diff-section added">
            <div className="diff-header">
              <span>Added</span>
              <button
                className="copy-code-button"
                onClick={() => config.onCopyCode?.(new_string, `edit-new-${messageId}`)}
                title="Copy added code"
              >
                {config.copiedCode === `edit-new-${messageId}` ? '✓' : '📋'}
              </button>
            </div>
            <pre className="diff-content">{newLines.join('\n')}</pre>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Render Write tool content
   */
  static renderWriteTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    const writeData = parseWriteTool(content);

    if (!writeData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, content: fileContent } = writeData;
    const { truncated, isTruncated, totalLines } = truncateContent(fileContent, 10);
    const isExpanded = config.expandedContent?.has(`write-${messageId}`) ?? false;
    const displayContent = isExpanded ? fileContent : truncated;

    // Extract file name and directory
    const fileName = file_path.split(/[/\\]/).pop() || file_path;
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'text';

    return (
      <div className="write-tool-content">
        <div
          className="write-file-header"
          onClick={() => config.onOpenFile?.(file_path)}
        >
          <div className="file-icon">📄</div>
          <div className="file-info">
            <div className="file-name-display">{fileName}</div>
            <div className="file-path-full">{file_path}</div>
          </div>
        </div>
        <div className="write-preview">
          <div className="write-preview-header">
            <span className="preview-label">Preview</span>
            <button
              className="copy-code-button"
              onClick={() => config.onCopyCode?.(fileContent, `write-${messageId}`)}
              title="Copy code"
            >
              {config.copiedCode === `write-${messageId}` ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={fileExtension}
            showLineNumbers
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '0 0 4px 4px', fontSize: '12px' }}
          >
            {displayContent}
          </SyntaxHighlighter>
        </div>
        {isTruncated && (
          <button
            className="expand-button"
            onClick={() => config.onToggleExpanded?.(`write-${messageId}`)}
          >
            {isExpanded ? 'Show Less' : `Show More (${totalLines - 10} more lines)`}
          </button>
        )}
      </div>
    );
  }

  /**
   * Render Read tool content
   */
  static renderReadTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    const readData = parseReadTool(content);

    if (!readData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    const { file_path, offset, limit } = readData;

    return (
      <div className="read-tool-content">
        {this.renderFilePathButton(file_path, undefined, 'medium', config.onOpenFile)}
        {(offset !== undefined || limit !== undefined) && (
          <div className="read-params">
            {offset !== undefined && <span className="param">Offset: {offset}</span>}
            {limit !== undefined && <span className="param">Limit: {limit}</span>}
          </div>
        )}
      </div>
    );
  }

  /**
   * Render Bash tool content
   */
  static renderBashTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { command, description } = parsed;

      return (
        <div className="bash-tool-content">
          {description && (
            <div className="tool-description">{description}</div>
          )}
          <div className="command-block">
            <div className="command-label">Command:</div>
            <code className="command-text">{command}</code>
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render Grep tool content
   */
  static renderGrepTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { pattern, path, glob, output_mode } = parsed;

      return (
        <div className="grep-tool-content">
          <div className="grep-params">
            <div className="grep-param">
              <span className="param-label">Pattern:</span>
              <code className="param-value">{pattern}</code>
            </div>
            {path && (
              <div className="grep-param">
                <span className="param-label">Path:</span>
                <code className="param-value">{path}</code>
              </div>
            )}
            {glob && (
              <div className="grep-param">
                <span className="param-label">Glob:</span>
                <code className="param-value">{glob}</code>
              </div>
            )}
            {output_mode && (
              <div className="grep-param">
                <span className="param-label">Mode:</span>
                <code className="param-value">{output_mode}</code>
              </div>
            )}
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render Glob tool content
   */
  static renderGlobTool(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { pattern, path } = parsed;

      return (
        <div className="glob-tool-content">
          <div className="glob-params">
            <div className="glob-param">
              <span className="param-label">Pattern:</span>
              <code className="param-value">{pattern}</code>
            </div>
            {path && (
              <div className="glob-param">
                <span className="param-label">Path:</span>
                <code className="param-value">{path}</code>
              </div>
            )}
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render ExitPlanMode tool (plan completion)
   */
  static renderExitPlanMode(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    const planData = parseExitPlanMode(content);

    if (!planData) {
      return <pre className="tool-input-content">{content}</pre>;
    }

    return (
      <div className="exit-plan-mode-content">
        <div className="plan-summary">
          <span className="plan-icon">📋</span>
          <span className="plan-label">Plan Ready</span>
        </div>
        <div className="plan-content">
          <ReactMarkdown>{planData.plan}</ReactMarkdown>
        </div>
      </div>
    );
  }

  /**
   * Render tool input based on tool type
   */
  static renderToolInput(
    toolName: string,
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    switch (toolName) {
      case 'TodoWrite':
        return this.renderTodoWrite(content, messageId, config);
      case 'Edit':
        return this.renderEditTool(content, messageId, config);
      case 'Write':
        return this.renderWriteTool(content, messageId, config);
      case 'Read':
        return this.renderReadTool(content, messageId, config);
      case 'Bash':
        return this.renderBashTool(content, messageId, config);
      case 'Grep':
        return this.renderGrepTool(content, messageId, config);
      case 'Glob':
        return this.renderGlobTool(content, messageId, config);
      case 'ExitPlanMode':
        return this.renderExitPlanMode(content, messageId, config);
      default:
        // Check if content contains file_path and render it
        try {
          const parsed = JSON.parse(content);
          if (parsed.file_path) {
            return (
              <div className="generic-tool-content">
                {this.renderFilePathButton(
                  parsed.file_path,
                  undefined,
                  'medium',
                  config.onOpenFile
                )}
                <pre className="tool-input-content">{content}</pre>
              </div>
            );
          }
        } catch (e) {
          // Not JSON, render as is
        }
        return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render enhanced markdown with file path detection
   */
  static renderEnhancedMarkdown(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
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
                    onClick={() => config.onCopyCode?.(codeString, codeId)}
                    title="Copy code"
                  >
                    {config.copiedCode === codeId ? '✓ Copied' : '📋 Copy'}
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
                        onClick={() => config.onOpenFile?.(ref.path, ref.lineNumber)}
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
  }

  /**
   * Render tool result content
   */
  static renderToolResult(content: string, isJson: boolean): JSX.Element {
    if (isJson) {
      return (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language="json"
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: '4px' }}
        >
          {content}
        </SyntaxHighlighter>
      );
    }

    return (
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
        {content}
      </ReactMarkdown>
    );
  }

  /**
   * Format and parse tool result for JSON
   */
  static formatToolResultContent(content: string): {
    formattedContent: string;
    isJson: boolean;
  } {
    try {
      const parsed = JSON.parse(content);
      return {
        formattedContent: JSON.stringify(parsed, null, 2),
        isJson: true,
      };
    } catch {
      return {
        formattedContent: content,
        isJson: false,
      };
    }
  }
}
