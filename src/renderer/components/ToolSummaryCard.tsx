import React from 'react';
import type { Message } from '../../shared/types';
import { formatToolName } from '../utils/messageFormatting';

interface ToolSummaryCardProps {
  message: Message;
  onClick?: () => void;
}

const ToolSummaryCard: React.FC<ToolSummaryCardProps> = ({ message, onClick }) => {
  const toolName = message.metadata?.toolName || 'Tool';
  const displayName = formatToolName(toolName);
  const isError = message.metadata?.isError || false;
  const isPending = message.metadata?.pendingPermission || false;
  const isDenied = message.metadata?.permissionDenied || false;

  const getToolSummary = (): { icon: string; text: string; detail?: string } => {
    switch (toolName) {
      case 'Edit': {
        try {
          const input = JSON.parse(message.content);
          const fileName = input.file_path?.split(/[/\\]/).pop() || 'file';
          return {
            icon: '✏️',
            text: `Edited ${fileName}`,
            detail: input.replace_all ? 'Replace all' : undefined
          };
        } catch {
          return { icon: '✏️', text: 'Edited file' };
        }
      }
      case 'Write': {
        try {
          const input = JSON.parse(message.content);
          const fileName = input.file_path?.split(/[/\\]/).pop() || 'file';
          const lines = input.content?.split('\n').length || 0;
          return {
            icon: '📝',
            text: `Created ${fileName}`,
            detail: `${lines} lines`
          };
        } catch {
          return { icon: '📝', text: 'Created file' };
        }
      }
      case 'Read': {
        try {
          const input = JSON.parse(message.content);
          const fileName = input.file_path?.split(/[/\\]/).pop() || 'file';
          return {
            icon: '📖',
            text: `Read ${fileName}`,
            detail: input.limit ? `${input.limit} lines` : undefined
          };
        } catch {
          return { icon: '📖', text: 'Read file' };
        }
      }
      case 'Bash': {
        try {
          const input = JSON.parse(message.content);
          const cmd = input.command?.split(' ')[0] || 'command';
          return {
            icon: '⚡',
            text: `Ran ${cmd}`,
            detail: input.description
          };
        } catch {
          return { icon: '⚡', text: 'Ran command' };
        }
      }
      case 'Grep': {
        try {
          const input = JSON.parse(message.content);
          return {
            icon: '🔍',
            text: 'Searched code',
            detail: `Pattern: ${input.pattern}`
          };
        } catch {
          return { icon: '🔍', text: 'Searched code' };
        }
      }
      case 'Glob': {
        try {
          const input = JSON.parse(message.content);
          return {
            icon: '📁',
            text: 'Found files',
            detail: input.pattern
          };
        } catch {
          return { icon: '📁', text: 'Found files' };
        }
      }
      case 'TodoWrite':
        return { icon: '✓', text: 'Updated tasks' };
      case 'WebSearch':
        return { icon: '🌐', text: 'Searched web' };
      case 'WebFetch':
        return { icon: '🌐', text: 'Fetched webpage' };
      case 'Task':
        return { icon: '🤖', text: 'Ran agent task' };
      default:
        return { icon: '🔧', text: displayName };
    }
  };

  const getResultSummary = (): { icon: string; text: string; detail?: string } => {
    const resultToolName = message.metadata?.toolName || 'Unknown';

    if (isError) {
      return { icon: '❌', text: `${formatToolName(resultToolName)} failed` };
    }

    switch (resultToolName) {
      case 'Bash': {
        const isEmpty = !message.content || message.content.trim().length === 0;
        if (isEmpty) {
          return { icon: '✓', text: 'Command completed' };
        }
        const lines = message.content.split('\n').length;
        return {
          icon: '✓',
          text: 'Command output',
          detail: `${lines} line${lines !== 1 ? 's' : ''}`
        };
      }
      case 'Read': {
        const lines = message.content.split('\n').length;
        return {
          icon: '✓',
          text: 'File read',
          detail: `${lines} lines`
        };
      }
      case 'Glob': {
        const files = message.content.split('\n').filter(l => l.trim()).length;
        return {
          icon: '✓',
          text: 'Files found',
          detail: `${files} file${files !== 1 ? 's' : ''}`
        };
      }
      case 'Grep': {
        const matches = message.content.split('\n').filter(l => l.trim()).length;
        return {
          icon: '✓',
          text: 'Matches found',
          detail: `${matches} result${matches !== 1 ? 's' : ''}`
        };
      }
      default:
        return { icon: '✓', text: `${formatToolName(resultToolName)} completed` };
    }
  };

  const summary = message.type === 'tool-result' ? getResultSummary() : getToolSummary();

  return (
    <div
      className={`tool-summary-card ${message.type} ${isError ? 'error' : ''} ${isPending ? 'pending' : ''} ${isDenied ? 'denied' : ''}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="tool-summary-icon">{summary.icon}</div>
      <div className="tool-summary-content">
        <div className="tool-summary-text">{summary.text}</div>
        {summary.detail && <div className="tool-summary-detail">{summary.detail}</div>}
        {isPending && <span className="tool-summary-badge pending">Awaiting Permission</span>}
        {isDenied && <span className="tool-summary-badge denied">Permission Denied</span>}
      </div>
      {onClick && (
        <div className="tool-summary-arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
};

export default ToolSummaryCard;
