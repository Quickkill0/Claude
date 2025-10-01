import React, { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import ConfirmDialog from './ConfirmDialog';
import SettingsModal from './SettingsModal';
import SessionSettingsModal from './SessionSettingsModal';
import AgentManagementModal from './AgentManagementModal';

const Sidebar: React.FC = () => {
  const { sessions, activeSessionId, createSession, switchSession, deleteSession, isSidebarOpen, toggleSidebar, toggleYoloMode, updateSessionModel, removeSessionPermission } = useSessionStore();
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionSettingsId, setSessionSettingsId] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);

  // Render collapsed sidebar when closed
  if (!isSidebarOpen) {
    return (
      <div className="sidebar-collapsed">
        <div className="sidebar-collapsed-header">
          <button className="btn-icon-collapsed" onClick={createSession} title="New Session">
            +
          </button>
        </div>

        <div className="sidebar-collapsed-content">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-icon ${session.id === activeSessionId ? 'active' : ''} ${session.isProcessing ? 'processing' : ''}`}
              onClick={() => switchSession(session.id)}
              title={session.name}
            >
              {session.name.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>

        <div className="sidebar-collapsed-footer">
          <button
            className="btn-icon-collapsed settings"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>

        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}

        {showAgents && activeSessionId && (
          <AgentManagementModal
            sessionId={activeSessionId}
            onClose={() => setShowAgents(false)}
          />
        )}

        <div className="sidebar-handle" onClick={toggleSidebar} title="Expand sidebar">
          <div className="sidebar-handle-bar"></div>
        </div>
      </div>
    );
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
                  <div className="session-item-info">
                    <div className={`session-item-name ${session.isProcessing ? 'processing' : ''}`}>{session.name}</div>
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
        <div className="sidebar-footer-actions">
          <button
            className="btn-icon agents"
            onClick={() => setShowAgents(true)}
            title="Agents"
          >
            🤖
          </button>
          <button
            className="btn-icon settings"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {sessionToDelete && (
        <ConfirmDialog
          title="Claude"
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
          onUpdateModel={updateSessionModel}
        />
      )}

      {showAgents && activeSessionId && (
        <AgentManagementModal
          sessionId={activeSessionId}
          onClose={() => setShowAgents(false)}
        />
      )}

      <div className="sidebar-handle" onClick={toggleSidebar} title="Collapse sidebar">
        <div className="sidebar-handle-bar"></div>
      </div>
    </div>
  );
};

export default Sidebar;