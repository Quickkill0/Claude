import React, { useState } from 'react';
import type { Session, Message } from '../../shared/types';

interface ExportModalProps {
  session: Session;
  messages: Message[];
  onClose: () => void;
}

const ExportModal: React.FC<ExportModalProps> = ({ session, messages, onClose }) => {
  const [exportFormat, setExportFormat] = useState<'markdown' | 'html' | 'json'>('markdown');
  const [includeToolOutputs, setIncludeToolOutputs] = useState(true);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const generateMarkdown = (): string => {
    let markdown = `# ${session.name}\n\n`;
    markdown += `**Model:** ${session.model}\n`;
    markdown += `**Working Directory:** ${session.workingDirectory}\n`;
    markdown += `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
    markdown += `**Total Cost:** $${(session.totalCost || 0).toFixed(4)}\n`;
    markdown += `**Total Tokens:** ${((session.tokenUsage?.inputTokens || 0) + (session.tokenUsage?.outputTokens || 0)).toLocaleString()}\n\n`;
    markdown += `---\n\n`;

    messages.forEach((msg) => {
      // Skip certain message types if not included
      if (!includeThinking && msg.type === 'thinking') return;
      if (!includeToolOutputs && (msg.type === 'tool' || msg.type === 'tool-result')) return;

      const timestamp = new Date(msg.timestamp).toLocaleString();

      switch (msg.type) {
        case 'user':
          markdown += `## 👤 User (${timestamp})\n\n${msg.content}\n\n`;
          break;
        case 'assistant':
          markdown += `## 🤖 Assistant (${timestamp})\n\n${msg.content}\n\n`;
          break;
        case 'system':
          markdown += `## ⚙️ System (${timestamp})\n\n${msg.content}\n\n`;
          break;
        case 'thinking':
          markdown += `## 💭 Thinking (${timestamp})\n\n${msg.content}\n\n`;
          break;
        case 'tool':
          markdown += `## 🔧 Tool: ${msg.metadata?.toolName || 'Unknown'} (${timestamp})\n\n`;
          markdown += `\`\`\`json\n${JSON.stringify(msg.metadata?.rawInput || msg.content, null, 2)}\n\`\`\`\n\n`;
          break;
        case 'tool-result':
          markdown += `## ✅ Tool Result (${timestamp})\n\n`;
          if (msg.metadata?.isError) {
            markdown += `**Error:** ${msg.content}\n\n`;
          } else {
            markdown += `\`\`\`\n${msg.content}\n\`\`\`\n\n`;
          }
          break;
        case 'error':
          markdown += `## ❌ Error (${timestamp})\n\n${msg.content}\n\n`;
          break;
      }
    });

    markdown += `---\n\n`;
    markdown += `*Exported from Claude Desktop on ${new Date().toLocaleString()}*\n`;

    return markdown;
  };

  const generateHTML = (): string => {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${session.name} - Conversation Export</title>
  <style>
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d30;
      --text-primary: #cccccc;
      --text-secondary: #858585;
      --accent-blue: #007acc;
      --accent-green: #4ec9b0;
      --accent-red: #f48771;
      --message-user-bg: #094771;
      --message-assistant-bg: #2d2d30;
      --border-color: #3e3e42;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    .header {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 32px;
    }

    .header h1 {
      margin: 0 0 16px 0;
      color: var(--accent-blue);
      font-size: 28px;
    }

    .metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      font-size: 14px;
      color: var(--text-secondary);
    }

    .metadata-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metadata-label {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }

    .metadata-value {
      color: var(--text-primary);
      font-size: 14px;
    }

    .message {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }

    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }

    .message-type {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .message-timestamp {
      color: var(--text-secondary);
      font-size: 12px;
    }

    .message-content {
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .message.user {
      border-left: 4px solid var(--accent-blue);
    }

    .message.assistant {
      border-left: 4px solid var(--accent-green);
    }

    .message.error {
      border-left: 4px solid var(--accent-red);
      background: rgba(244, 135, 113, 0.1);
    }

    .message.tool {
      border-left: 4px solid #ff9800;
    }

    code {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
    }

    pre {
      background: var(--bg-tertiary);
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .footer {
      text-align: center;
      color: var(--text-secondary);
      font-size: 13px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border-color);
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg-primary: #ffffff;
        --bg-secondary: #f3f3f3;
        --bg-tertiary: #e8e8e8;
        --text-primary: #1e1e1e;
        --text-secondary: #6e6e6e;
        --border-color: #d0d0d0;
        --message-user-bg: #e3f2fd;
        --message-assistant-bg: #f5f5f5;
      }

      body {
        background: var(--bg-primary);
        color: var(--text-primary);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${session.name}</h1>
    <div class="metadata">
      <div class="metadata-item">
        <div class="metadata-label">Model</div>
        <div class="metadata-value">${session.model}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Working Directory</div>
        <div class="metadata-value">${session.workingDirectory}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Created</div>
        <div class="metadata-value">${new Date(session.createdAt).toLocaleString()}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Total Cost</div>
        <div class="metadata-value">$${(session.totalCost || 0).toFixed(4)}</div>
      </div>
      <div class="metadata-item">
        <div class="metadata-label">Total Tokens</div>
        <div class="metadata-value">${((session.tokenUsage?.inputTokens || 0) + (session.tokenUsage?.outputTokens || 0)).toLocaleString()}</div>
      </div>
    </div>
  </div>

  <div class="messages">
`;

    messages.forEach((msg) => {
      // Skip certain message types if not included
      if (!includeThinking && msg.type === 'thinking') return;
      if (!includeToolOutputs && (msg.type === 'tool' || msg.type === 'tool-result')) return;

      const timestamp = new Date(msg.timestamp).toLocaleString();
      let icon = '';
      let typeLabel = '';

      switch (msg.type) {
        case 'user':
          icon = '👤';
          typeLabel = 'User';
          break;
        case 'assistant':
          icon = '🤖';
          typeLabel = 'Assistant';
          break;
        case 'system':
          icon = '⚙️';
          typeLabel = 'System';
          break;
        case 'thinking':
          icon = '💭';
          typeLabel = 'Thinking';
          break;
        case 'tool':
          icon = '🔧';
          typeLabel = `Tool: ${msg.metadata?.toolName || 'Unknown'}`;
          break;
        case 'tool-result':
          icon = '✅';
          typeLabel = 'Tool Result';
          break;
        case 'error':
          icon = '❌';
          typeLabel = 'Error';
          break;
      }

      html += `    <div class="message ${msg.type}">
      <div class="message-header">
        <div class="message-type">${icon} ${typeLabel}</div>
        <div class="message-timestamp">${timestamp}</div>
      </div>
      <div class="message-content">`;

      if (msg.type === 'tool') {
        html += `<pre>${JSON.stringify(msg.metadata?.rawInput || msg.content, null, 2)}</pre>`;
      } else if (msg.type === 'tool-result' && !msg.metadata?.isError) {
        html += `<pre>${msg.content}</pre>`;
      } else {
        html += msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      }

      html += `</div>
    </div>
`;
    });

    html += `  </div>

  <div class="footer">
    <p>Exported from Claude Desktop on ${new Date().toLocaleString()}</p>
  </div>
</body>
</html>`;

    return html;
  };

  const generateJSON = (): string => {
    const exportData = {
      session: {
        id: session.id,
        name: session.name,
        model: session.model,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        totalCost: session.totalCost,
        tokenUsage: session.tokenUsage,
      },
      messages: messages.map((msg) => ({
        id: msg.id,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
        metadata: msg.metadata,
      })),
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      let content: string;
      let filename: string;
      let mimeType: string;

      switch (exportFormat) {
        case 'markdown':
          content = generateMarkdown();
          filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}_conversation.md`;
          mimeType = 'text/markdown';
          break;
        case 'html':
          content = generateHTML();
          filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}_conversation.html`;
          mimeType = 'text/html';
          break;
        case 'json':
          content = generateJSON();
          filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}_conversation.json`;
          mimeType = 'application/json';
          break;
      }

      // Create a download link
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Close modal after short delay
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export conversation. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    try {
      let content: string;

      switch (exportFormat) {
        case 'markdown':
          content = generateMarkdown();
          break;
        case 'html':
          content = generateHTML();
          break;
        case 'json':
          content = generateJSON();
          break;
      }

      await navigator.clipboard.writeText(content);
      alert('Conversation copied to clipboard!');
    } catch (error) {
      console.error('Copy failed:', error);
      alert('Failed to copy to clipboard. Please try again.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Conversation</h2>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="export-options">
            <div className="export-section">
              <h3>Export Format</h3>
              <div className="format-options">
                <button
                  className={`format-btn ${exportFormat === 'markdown' ? 'active' : ''}`}
                  onClick={() => setExportFormat('markdown')}
                >
                  <span className="format-icon">📝</span>
                  <div className="format-info">
                    <div className="format-name">Markdown</div>
                    <div className="format-desc">Plain text with formatting</div>
                  </div>
                </button>
                <button
                  className={`format-btn ${exportFormat === 'html' ? 'active' : ''}`}
                  onClick={() => setExportFormat('html')}
                >
                  <span className="format-icon">🌐</span>
                  <div className="format-info">
                    <div className="format-name">HTML</div>
                    <div className="format-desc">Styled web page</div>
                  </div>
                </button>
                <button
                  className={`format-btn ${exportFormat === 'json' ? 'active' : ''}`}
                  onClick={() => setExportFormat('json')}
                >
                  <span className="format-icon">📦</span>
                  <div className="format-info">
                    <div className="format-name">JSON</div>
                    <div className="format-desc">Raw structured data</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="export-section">
              <h3>Include</h3>
              <div className="export-checkboxes">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeToolOutputs}
                    onChange={(e) => setIncludeToolOutputs(e.target.checked)}
                  />
                  <span>Tool calls and results</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeThinking}
                    onChange={(e) => setIncludeThinking(e.target.checked)}
                  />
                  <span>Thinking blocks</span>
                </label>
              </div>
            </div>

            <div className="export-stats">
              <div className="stat">
                <span className="stat-label">Messages:</span>
                <span className="stat-value">{messages.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Size:</span>
                <span className="stat-value">
                  {(new Blob([exportFormat === 'markdown' ? generateMarkdown() : exportFormat === 'html' ? generateHTML() : generateJSON()]).size / 1024).toFixed(1)} KB
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn outlined" onClick={handleCopyToClipboard} disabled={isExporting}>
            📋 Copy to Clipboard
          </button>
          <button className="btn primary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : '💾 Download'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
