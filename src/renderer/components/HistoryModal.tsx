import React, { useEffect, useState } from 'react';
import type { Session } from '../../shared/types';

interface HistoryModalProps {
  session: Session;
  onClose: () => void;
  onLoadConversation: (conversationId: string) => void;
}

interface Conversation {
  conversationId: string;
  timestamp: string;
  messageCount: number;
  firstMessage: string;
  isActive?: boolean;
}

const HistoryModal: React.FC<HistoryModalProps> = ({ session, onClose, onLoadConversation }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, [session.id]);

  const loadConversations = async () => {
    try {
      console.log('[HistoryModal] Loading conversations for session:', session.id);
      const convs = await window.electronAPI.getConversations(session.id);
      console.log('[HistoryModal] Loaded conversations:', convs);
      setConversations(convs);
    } catch (error) {
      console.error('[HistoryModal] Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadConversation = (conversationId: string) => {
    onLoadConversation(conversationId);
    onClose();
  };

  const formatDate = (timestamp: string) => {
    try {
      const date = new Date(timestamp);

      if (isNaN(date.getTime())) {
        return timestamp;
      }

      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
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
              {conversations.map((conv) => (
                <div
                  key={conv.conversationId}
                  className={`history-item ${conv.isActive ? 'active' : ''}`}
                  onClick={() => handleLoadConversation(conv.conversationId)}
                >
                  <div className="history-item-header">
                    <span className="history-item-date">
                      {formatDate(conv.timestamp)}
                      {conv.isActive && <span className="active-badge"> • Active</span>}
                    </span>
                    <span className="history-item-count">{conv.messageCount} messages</span>
                  </div>
                  <div className="history-item-preview">{conv.firstMessage}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;