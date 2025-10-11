import React, { useState, useMemo } from 'react';
import type { Session, Message } from '../../shared/types';

interface ContextIndicatorProps {
  session: Session;
  messages: Message[];
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
  pinnedMessageIds?: string[];
}

const ContextIndicator: React.FC<ContextIndicatorProps> = ({
  session,
  messages,
  onPinMessage,
  onUnpinMessage,
  pinnedMessageIds = [],
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'user' | 'assistant' | 'tool'>('all');

  // Calculate context metrics
  const contextMetrics = useMemo(() => {
    const totalTokens = (session.tokenUsage?.inputTokens || 0) + (session.tokenUsage?.outputTokens || 0);
    const cacheTokens = (session.tokenUsage?.cacheCreationTokens || 0) + (session.tokenUsage?.cacheReadTokens || 0);

    // Model context limits
    const contextLimits: Record<string, number> = {
      opus: 200000,
      sonnet: 200000,
      sonnet1m: 1000000,
      default: 200000,
    };

    const contextLimit = contextLimits[session.model] || 200000;
    const contextUsagePercent = (totalTokens / contextLimit) * 100;

    // Calculate approximate context usage per message
    const messageContexts = messages.map((msg) => {
      const tokens = msg.metadata?.tokens || { input: 0, output: 0 };
      return {
        id: msg.id,
        tokens: tokens.input + tokens.output,
        isPinned: pinnedMessageIds.includes(msg.id),
      };
    });

    return {
      totalTokens,
      cacheTokens,
      contextLimit,
      contextUsagePercent,
      messageCount: messages.length,
      messageContexts,
    };
  }, [session, messages, pinnedMessageIds]);

  // Filter messages for search/filter UI
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      // Filter by type
      if (filterType !== 'all') {
        if (filterType === 'tool' && msg.type !== 'tool' && msg.type !== 'tool-result') {
          return false;
        } else if (filterType !== 'tool' && msg.type !== filterType) {
          return false;
        }
      }

      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const content = msg.content?.toLowerCase() || '';
        const toolName = msg.metadata?.toolName?.toLowerCase() || '';
        return content.includes(query) || toolName.includes(query);
      }

      return true;
    });
  }, [messages, searchQuery, filterType]);

  // Get status color based on usage
  const getStatusColor = () => {
    if (contextMetrics.contextUsagePercent < 50) return '#4CAF50'; // Green
    if (contextMetrics.contextUsagePercent < 75) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };

  const handleTogglePin = (messageId: string) => {
    if (pinnedMessageIds.includes(messageId)) {
      onUnpinMessage?.(messageId);
    } else {
      onPinMessage?.(messageId);
    }
  };

  return (
    <div className={`context-indicator-inline ${isExpanded ? 'expanded' : ''}`}>
      <div className="context-indicator-trigger" onClick={() => setIsExpanded(!isExpanded)}>
        <div
          className="context-usage-badge"
          style={{
            backgroundColor: getStatusColor(),
            opacity: 0.15,
          }}
        >
          <div
            className="context-usage-fill"
            style={{
              width: `${Math.min(contextMetrics.contextUsagePercent, 100)}%`,
              backgroundColor: getStatusColor(),
            }}
          />
        </div>
        <span className="context-info-text">
          {contextMetrics.totalTokens.toLocaleString()} / {contextMetrics.contextLimit.toLocaleString()}
        </span>
        <span className="context-expand-icon">{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div className="context-indicator-expanded">
          <div className="context-stats">
            <div className="context-stat">
              <span className="stat-label">Total Tokens</span>
              <span className="stat-value">{contextMetrics.totalTokens.toLocaleString()}</span>
            </div>
            <div className="context-stat">
              <span className="stat-label">Cache Tokens</span>
              <span className="stat-value">{contextMetrics.cacheTokens.toLocaleString()}</span>
            </div>
            <div className="context-stat">
              <span className="stat-label">Messages</span>
              <span className="stat-value">{contextMetrics.messageCount}</span>
            </div>
            <div className="context-stat">
              <span className="stat-label">Pinned</span>
              <span className="stat-value">{pinnedMessageIds.length}</span>
            </div>
          </div>

          <div className="context-search">
            <input
              type="text"
              className="context-search-input"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="context-filters">
              <button
                className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterType('all');
                }}
              >
                All
              </button>
              <button
                className={`filter-btn ${filterType === 'user' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterType('user');
                }}
              >
                User
              </button>
              <button
                className={`filter-btn ${filterType === 'assistant' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterType('assistant');
                }}
              >
                Assistant
              </button>
              <button
                className={`filter-btn ${filterType === 'tool' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterType('tool');
                }}
              >
                Tools
              </button>
            </div>
          </div>

          {(searchQuery || filterType !== 'all') && (
            <div className="context-results">
              <div className="results-header">
                <span className="results-count">{filteredMessages.length} results</span>
                {(searchQuery || filterType !== 'all') && (
                  <button
                    className="clear-filters-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery('');
                      setFilterType('all');
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="results-list">
                {filteredMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`result-item ${pinnedMessageIds.includes(msg.id) ? 'pinned' : ''}`}
                  >
                    <div className="result-content">
                      <span className="result-type">{msg.type}</span>
                      <span className="result-text">
                        {msg.content?.substring(0, 100) || msg.metadata?.toolName || 'No content'}
                        {msg.content && msg.content.length > 100 ? '...' : ''}
                      </span>
                    </div>
                    <button
                      className="pin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(msg.id);
                      }}
                      title={pinnedMessageIds.includes(msg.id) ? 'Unpin message' : 'Pin message'}
                    >
                      📌
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pinnedMessageIds.length > 0 && !searchQuery && filterType === 'all' && (
            <div className="pinned-messages-section">
              <div className="pinned-header">
                <span className="pinned-title">Pinned Messages</span>
                <span className="pinned-count">{pinnedMessageIds.length}</span>
              </div>
              <div className="pinned-list">
                {messages
                  .filter((msg) => pinnedMessageIds.includes(msg.id))
                  .map((msg) => (
                    <div key={msg.id} className="pinned-item">
                      <div className="pinned-content">
                        <span className="pinned-type">{msg.type}</span>
                        <span className="pinned-text">
                          {msg.content?.substring(0, 80) || msg.metadata?.toolName || 'No content'}
                          {msg.content && msg.content.length > 80 ? '...' : ''}
                        </span>
                      </div>
                      <button
                        className="unpin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(msg.id);
                        }}
                        title="Unpin message"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContextIndicator;
