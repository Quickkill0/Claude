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
  removeSystemReminders,
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

    // Extract file extension for syntax highlighting
    const fileName = file_path.split(/[/\\]/).pop() || file_path;
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'text';

    return (
      <div className="write-tool-content">
        <div className="write-file-path">
          {this.renderFilePathButton(file_path, undefined, 'medium', config.onOpenFile)}
        </div>
        <div className="write-preview-section">
          <div className="write-preview-header">
            <span className="preview-label">PREVIEW</span>
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
            customStyle={{ margin: 0, fontSize: '12px' }}
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
   * Render BashOutput tool
   */
  static renderBashOutput(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { bash_id, filter } = parsed;

      return (
        <div className="bash-output-tool-content">
          <div className="tool-params">
            <div className="tool-param">
              <span className="param-label">Shell ID:</span>
              <code className="param-value">{bash_id}</code>
            </div>
            {filter && (
              <div className="tool-param">
                <span className="param-label">Filter:</span>
                <code className="param-value">{filter}</code>
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
   * Render KillShell tool
   */
  static renderKillShell(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { shell_id } = parsed;

      return (
        <div className="kill-shell-tool-content">
          <div className="tool-param">
            <span className="param-label">Terminating Shell:</span>
            <code className="param-value">{shell_id}</code>
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render WebSearch tool
   */
  static renderWebSearch(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { query, allowed_domains, blocked_domains } = parsed;

      return (
        <div className="web-search-tool-content">
          <div className="search-query">
            <span className="search-icon">🔍</span>
            <span className="query-text">{query}</span>
          </div>
          {allowed_domains && allowed_domains.length > 0 && (
            <div className="search-domains allowed">
              <span className="domain-label">Allowed domains:</span>
              <div className="domain-list">
                {allowed_domains.map((domain: string, idx: number) => (
                  <span key={idx} className="domain-tag">{domain}</span>
                ))}
              </div>
            </div>
          )}
          {blocked_domains && blocked_domains.length > 0 && (
            <div className="search-domains blocked">
              <span className="domain-label">Blocked domains:</span>
              <div className="domain-list">
                {blocked_domains.map((domain: string, idx: number) => (
                  <span key={idx} className="domain-tag">{domain}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render WebFetch tool
   */
  static renderWebFetch(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { url, prompt } = parsed;

      return (
        <div className="web-fetch-tool-content">
          <div className="fetch-url">
            <span className="fetch-icon">🌐</span>
            <a href={url} target="_blank" rel="noopener noreferrer" className="url-link">
              {url}
            </a>
          </div>
          {prompt && (
            <div className="fetch-prompt">
              <span className="param-label">Processing with:</span>
              <div className="prompt-text">{prompt}</div>
            </div>
          )}
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render NotebookEdit tool
   */
  static renderNotebookEdit(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { notebook_path, cell_id, cell_type, edit_mode } = parsed;

      return (
        <div className="notebook-edit-tool-content">
          <div className="notebook-info">
            {this.renderFilePathButton(notebook_path, undefined, 'medium', config.onOpenFile)}
            <div className="notebook-details">
              {cell_id && <span className="detail-badge">Cell: {cell_id}</span>}
              {cell_type && <span className="detail-badge">{cell_type}</span>}
              {edit_mode && <span className="detail-badge mode">{edit_mode}</span>}
            </div>
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render SlashCommand tool
   */
  static renderSlashCommand(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { command } = parsed;

      return (
        <div className="slash-command-tool-content">
          <div className="command-display">
            <span className="command-icon">⚡</span>
            <code className="command-code">{command}</code>
          </div>
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
  }

  /**
   * Render Task tool (agent invocation)
   */
  static renderTask(
    content: string,
    messageId: string,
    config: RenderConfig
  ): JSX.Element {
    try {
      const parsed = JSON.parse(content);
      const { description, prompt, subagent_type } = parsed;

      return (
        <div className="task-tool-content">
          <div className="task-header">
            <span className="task-icon">🤖</span>
            <span className="task-description">{description || 'Running agent task'}</span>
          </div>
          {subagent_type && (
            <div className="task-agent">
              <span className="param-label">Agent:</span>
              <code className="param-value">{subagent_type}</code>
            </div>
          )}
          {prompt && (
            <div className="task-prompt">
              <span className="param-label">Prompt:</span>
              <div className="prompt-text">{prompt}</div>
            </div>
          )}
        </div>
      );
    } catch (e) {
      return <pre className="tool-input-content">{content}</pre>;
    }
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
      case 'NotebookEdit':
        return this.renderNotebookEdit(content, messageId, config);
      case 'WebFetch':
        return this.renderWebFetch(content, messageId, config);
      case 'WebSearch':
        return this.renderWebSearch(content, messageId, config);
      case 'BashOutput':
        return this.renderBashOutput(content, messageId, config);
      case 'KillShell':
        return this.renderKillShell(content, messageId, config);
      case 'SlashCommand':
        return this.renderSlashCommand(content, messageId, config);
      case 'Task':
        return this.renderTask(content, messageId, config);
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
    // Remove system reminders before rendering
    const cleanContent = removeSystemReminders(content);
    const fileRefs = extractFileReferences(cleanContent);

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
        {cleanContent}
      </ReactMarkdown>
    );
  }

  /**
   * Detect if content looks like code output with line numbers (cat -n format)
   */
  static detectLineNumberedContent(content: string): { hasLineNumbers: boolean; language?: string } {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 3) return { hasLineNumbers: false };

    // Check if most lines start with line numbers (format: "   123\t")
    const lineNumberPattern = /^\s+\d+\t/;
    const linesWithNumbers = lines.filter(line => lineNumberPattern.test(line)).length;
    const ratio = linesWithNumbers / lines.length;

    if (ratio > 0.7) {
      // Try to detect language from content
      const firstLine = lines[0].replace(lineNumberPattern, '').trim();

      // Check for common language patterns
      if (firstLine.match(/^(import|from|def|class)\s/) || content.includes('def ') || content.includes('import ')) {
        return { hasLineNumbers: true, language: 'python' };
      } else if (firstLine.match(/^(const|let|var|function|class|import|export)\s/) || content.includes('=>')) {
        return { hasLineNumbers: true, language: 'javascript' };
      } else if (firstLine.match(/^(package|import|func|type|var)\s/)) {
        return { hasLineNumbers: true, language: 'go' };
      } else if (firstLine.match(/^(use|fn|impl|struct|enum)\s/)) {
        return { hasLineNumbers: true, language: 'rust' };
      } else if (content.includes('<?php') || firstLine.match(/^(namespace|class|function|public|private)\s/)) {
        return { hasLineNumbers: true, language: 'php' };
      } else if (content.includes('<html') || content.includes('<!DOCTYPE') || firstLine.match(/^<\w+/)) {
        return { hasLineNumbers: true, language: 'html' };
      } else if (content.includes('{') && content.includes('}') && (firstLine.match(/^[\w-]+\s*{/) || content.includes('font-') || content.includes('color:'))) {
        return { hasLineNumbers: true, language: 'css' };
      }

      return { hasLineNumbers: true };
    }

    return { hasLineNumbers: false };
  }

  /**
   * Detect if content looks like a file listing
   */
  static detectFileListing(content: string): boolean {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return false;

    // Check if most lines look like file paths
    const filePathPattern = /^[^\s]+\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|scss|html|json|yaml|yml|md|txt|sh|xml|php|rb|cs|swift)/i;
    const linesLikeFiles = lines.filter(line => filePathPattern.test(line.trim())).length;
    const ratio = linesLikeFiles / lines.length;

    return ratio > 0.6;
  }

  /**
   * Render tool result content with improved parsing
   */
  static renderToolResult(content: string, isJson: boolean): JSX.Element {
    if (isJson) {
      return (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language="json"
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: '4px', fontSize: '12px' }}
          showLineNumbers
        >
          {content}
        </SyntaxHighlighter>
      );
    }

    // Check if content has line numbers (like cat -n output)
    const lineNumberInfo = this.detectLineNumberedContent(content);
    if (lineNumberInfo.hasLineNumbers) {
      // Remove line numbers for syntax highlighting
      const cleanContent = content.split('\n')
        .map(line => line.replace(/^\s+\d+\t/, ''))
        .join('\n');

      return (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={lineNumberInfo.language || 'text'}
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: '4px', fontSize: '12px' }}
          showLineNumbers
        >
          {cleanContent}
        </SyntaxHighlighter>
      );
    }

    // Check if content is a file listing
    if (this.detectFileListing(content)) {
      const files = content.split('\n').filter(line => line.trim());
      return (
        <div className="file-listing-result">
          <div className="file-listing-header">
            <span className="file-icon">📁</span>
            <span className="file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="file-listing-content">
            {files.map((file, idx) => {
              const fileName = file.trim();
              return (
                <div key={idx} className="file-listing-item">
                  <span className="file-icon">{getFileIcon(fileName)}</span>
                  <span className="file-name">{fileName}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Default: render as markdown with code block support
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
                customStyle={{ margin: 0, fontSize: '12px' }}
                showLineNumbers
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
