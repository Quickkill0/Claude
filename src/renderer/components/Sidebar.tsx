import React, { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import ConfirmDialog from './ConfirmDialog';
import SettingsModal from './SettingsModal';
import SessionSettingsModal from './SessionSettingsModal';

const Sidebar: React.FC = () => {
  const { sessions, activeSessionId, createSession, switchSession, deleteSession, isSidebarOpen, toggleYoloMode, updateSessionModel, removeSessionPermission } = useSessionStore();
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionSettingsId, setSessionSettingsId] = useState<string | null>(null);

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Active Sessions</h3>
        <button className="btn-icon" onClick={createSession} title="New Session">
          +
        </button>
      </div>

      <div className="sidebar-content">
        {sessions.length === 0 ? (
          <div className="sidebar-empty">
            <p>No sessions yet</p>
            <button className="btn primary small" onClick={createSession}>
              Create First Session
            </button>
          </div>
        ) : (
          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? 'active' : ''} ${session.isProcessing ? 'processing' : ''}`}
              >
                <div className="session-item-actions">
                  <button
                    className="session-settings-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionSettingsId(session.id);
                    }}
                    title="Session settings"
                  >
                    ⚙️
                  </button>
                  <button
                    className={`session-yolo-toggle ${session.yoloMode ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleYoloMode(session.id);
                    }}
                    title={session.yoloMode ? 'YOLO mode enabled (permissions bypassed)' : 'YOLO mode disabled'}
                  >
                    {session.yoloMode ? '🚀' : '🔒'}
                  </button>
                  <button
                    className="session-item-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionToDelete({ id: session.id, name: session.name });
                    }}
                    title="Close session"
                  >
                    ×
                  </button>
                </div>
                <div
                  className="session-item-content"
                  onClick={() => switchSession(session.id)}
                >
                  <div className="session-item-icon">
                    {session.isProcessing ? '⚡' : '📁'}
                  </div>
                  <div className="session-item-info">
                    <div className="session-item-name">{session.name}</div>
                    <select
                      className="session-item-model"
                      value={session.model}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateSessionModel(session.id, e.target.value as 'opus' | 'sonnet' | 'sonnet1m' | 'default');
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={session.isProcessing}
                    >
                      <option value="default">Default</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="opus">Opus</option>
                      <option value="sonnet1m">1M</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-stats">
          <span>{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
        </div>
        <button
          className="btn-icon settings"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {sessionToDelete && (
        <ConfirmDialog
          title="claude-desktop"
          message={`Close session "${sessionToDelete.name}"?`}
          onConfirm={() => {
            deleteSession(sessionToDelete.id);
            setSessionToDelete(null);
          }}
          onCancel={() => setSessionToDelete(null)}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {sessionSettingsId && (
        <SessionSettingsModal
          session={sessions.find(s => s.id === sessionSettingsId)!}
          onClose={() => setSessionSettingsId(null)}
          onRemovePermission={removeSessionPermission}
        />
      )}
    </div>
  );
};

export default Sidebar;