import React, { useEffect, useState } from 'react';

interface HistoryModalProps {
  sessionId: string;
  onClose: () => void;
  onLoadConversation: (filename: string) => void;
  currentArchiveKey?: string | null;
}

interface ArchivedConversation {
  filename: string;
  timestamp: string;
  messageCount: number;
  firstMessage: string;
  isCurrent?: boolean;
}

const HistoryModal: React.FC<HistoryModalProps> = ({ sessionId, onClose, onLoadConversation, currentArchiveKey }) => {
  const [conversations, setConversations] = useState<ArchivedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, [sessionId]);

  const loadConversations = async () => {
    try {
      console.log('HistoryModal: loading conversations for sessionId:', sessionId);
      const archived = await window.electronAPI.getArchivedConversations(sessionId);
      console.log('HistoryModal: received archived conversations:', archived);
      setConversations(archived);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadConversation = (filename: string) => {
    onLoadConversation(filename);
    onClose();
  };

  const formatDate = (timestamp: string) => {
    try {
      // Convert timestamp from our storage format (2025-09-30T23-38-18.961Z)
      // back to ISO format (2025-09-30T23:38:18.961Z) by replacing dashes after T with colons
      const isoTimestamp = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
      const date = new Date(isoTimestamp);

      if (isNaN(date.getTime())) {
        return timestamp;
      }

      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Conversation History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="history-loading">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="history-empty">No archived conversations found</div>
          ) : (
            <div className="history-list">
              {conversations.map((conv) => {
                const isActive = currentArchiveKey === conv.filename;
                return (
                  <div
                    key={conv.filename}
                    className={`history-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleLoadConversation(conv.filename)}
                  >
                    <div className="history-item-header">
                      <span className="history-item-date">
                        {formatDate(conv.timestamp)}
                        {isActive && <span className="active-badge"> • Active</span>}
                      </span>
                      <span className="history-item-count">{conv.messageCount} messages</span>
                    </div>
                    <div className="history-item-preview">{conv.firstMessage}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;