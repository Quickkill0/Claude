import React, { useState, useEffect, useRef } from 'react';
import type { Message } from '../../shared/types';
import { MessageRenderer } from '../utils/messageRenderer';
import { formatToolName } from '../utils/messageFormatting';

interface ActivityPanelProps {
  messages: Message[];
  isCollapsed: boolean;
  onToggle: () => void;
  highlightMessageId?: string | null;
}

const ActivityPanel: React.FC<ActivityPanelProps> = ({ messages, isCollapsed, onToggle, highlightMessageId }) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<'all' | 'tool' | 'tool-result' | 'error'>('all');
  const [panelWidth, setPanelWidth] = useState<number>(400);
  const [isResizing, setIsResizing] = useState(false);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const timelineRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);

  // Auto-expand and scroll to highlighted message
  useEffect(() => {
    if (highlightMessageId && !isCollapsed) {
      // Find the message to determine its type
      const message = messages.find(m => m.id === highlightMessageId);

      // Set filter to show the message type (or 'all' to be safe)
      if (message) {
        setFilterType('all');
      }

      // Expand the item
      setExpandedItems(prev => {
        const newSet = new Set(prev);
        newSet.add(highlightMessageId);
        return newSet;
      });

      // Scroll to the item after a brief delay for DOM update and filter change
      setTimeout(() => {
        const element = itemRefs.current.get(highlightMessageId);
        if (element && timelineRef.current) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Add flash highlight effect
          element.classList.add('activity-item-highlight');
          setTimeout(() => {
            element.classList.remove('activity-item-highlight');
          }, 2000);
        } else {
          console.warn('[ActivityPanel] Could not find element for message:', highlightMessageId);
        }
      }, 150);
    }
  }, [highlightMessageId, isCollapsed, messages]);

  // Filter only tool-related messages
  const toolMessages = messages.filter((msg) => {
    if (filterType === 'all') {
      return msg.type === 'tool' || msg.type === 'tool-result' || msg.type === 'error';
    }
    return msg.type === filterType;
  });

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const getToolIcon = (type: Message['type'], isError?: boolean) => {
    if (type === 'error' || isError) return '❌';
    if (type === 'tool-result') return '✓';
    return '⚡';
  };

  const getToolStatus = (type: Message['type'], isError?: boolean) => {
    if (type === 'error' || isError) return 'error';
    if (type === 'tool-result') return 'success';
    return 'running';
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Handle mouse down on handle (could be click or drag)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    hasMovedRef.current = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - startXRef.current);
      if (deltaX > 5 && !hasMovedRef.current) {
        hasMovedRef.current = true;
        setIsResizing(true);
      }

      if (hasMovedRef.current) {
        const newWidth = window.innerWidth - moveEvent.clientX;
        const constrainedWidth = Math.min(Math.max(newWidth, 280), 800);
        setPanelWidth(constrainedWidth);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (isResizing) {
        setIsResizing(false);
      }

      // If no significant movement, treat as click to collapse
      if (!hasMovedRef.current) {
        onToggle();
      }

      hasMovedRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (isCollapsed) {
    return (
      <div className="activity-panel-collapsed">
        <div className="activity-panel-collapsed-content">
          <div className="activity-panel-icon" title="Activity Panel">
            ⚡
          </div>
        </div>

        <div className="activity-panel-handle" onClick={onToggle} title="Expand Activity Panel">
          <div className="activity-panel-handle-bar"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`activity-panel ${isResizing ? 'resizing' : ''}`} ref={panelRef} style={{ width: `${panelWidth}px` }}>
      <div className="activity-panel-header">
        <div className="activity-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="6" r="2" fill="currentColor"/>
            <circle cx="12" cy="12" r="2" fill="currentColor"/>
            <circle cx="12" cy="18" r="2" fill="currentColor"/>
          </svg>
          <span>Activity Timeline</span>
          <span className="activity-count">{toolMessages.length}</span>
        </div>
      </div>

      <div className="activity-panel-handle" onMouseDown={handleMouseDown} title="Click to collapse, drag to resize">
        <div className="activity-panel-handle-bar"></div>
      </div>

      <div className="activity-panel-filters">
        <button
          className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
          onClick={() => setFilterType('all')}
        >
          All
        </button>
        <button
          className={`filter-btn ${filterType === 'tool' ? 'active' : ''}`}
          onClick={() => setFilterType('tool')}
        >
          Tools
        </button>
        <button
          className={`filter-btn ${filterType === 'tool-result' ? 'active' : ''}`}
          onClick={() => setFilterType('tool-result')}
        >
          Results
        </button>
        <button
          className={`filter-btn ${filterType === 'error' ? 'active' : ''}`}
          onClick={() => setFilterType('error')}
        >
          Errors
        </button>
      </div>

      <div className="activity-panel-timeline" ref={timelineRef}>
        {toolMessages.length === 0 ? (
          <div className="activity-empty">
            <p>No tool activity yet</p>
          </div>
        ) : (
          toolMessages.map((message) => {
            const isExpanded = expandedItems.has(message.id);
            const toolName = message.metadata?.toolName || 'Unknown';
            const isError = message.type === 'error' || message.metadata?.isError;
            const status = getToolStatus(message.type, isError);

            return (
              <div
                key={message.id}
                className={`activity-item ${status}`}
                ref={(el) => {
                  if (el) {
                    itemRefs.current.set(message.id, el);
                  } else {
                    itemRefs.current.delete(message.id);
                  }
                }}
              >
                <div className="activity-item-header" onClick={() => toggleExpanded(message.id)}>
                  <div className="activity-item-icon">{getToolIcon(message.type, isError)}</div>
                  <div className="activity-item-info">
                    <div className="activity-item-title">
                      {message.type === 'tool' && formatToolName(toolName)}
                      {message.type === 'tool-result' && `Result: ${formatToolName(toolName)}`}
                      {message.type === 'error' && 'Error'}
                    </div>
                    <div className="activity-item-time">{formatTimestamp(message.timestamp)}</div>
                  </div>
                  <div className="activity-item-expand">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>

                {isExpanded && (
                  <div className="activity-item-content">
                    {message.type === 'tool' && (
                      MessageRenderer.renderToolInput(
                        toolName,
                        message.content,
                        message.id,
                        {}
                      )
                    )}
                    {message.type === 'tool-result' && (
                      <div className="tool-result-content">
                        {MessageRenderer.renderToolResult(
                          message.content,
                          false,
                          toolName,
                          message.id,
                          {}
                        )}
                      </div>
                    )}
                    {message.type === 'error' && (
                      <div className="error-content">
                        <pre>{message.content}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityPanel;
