import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import ChatWindow from './components/ChatWindow';
import Sidebar from './components/Sidebar';
import PermissionDialog from './components/PermissionDialog';
import { useSessionStore } from './store/sessionStore';
import type { PermissionRequest } from '../shared/types';

const App: React.FC = () => {
  const { sessions, activeSessionId, initializeSessions, createSession, isSidebarOpen, toggleSidebar } = useSessionStore();
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);

  useEffect(() => {
    // Initialize sessions from Electron
    initializeSessions();

    // Listen for permission requests
    window.electronAPI.onPermissionRequest((request: PermissionRequest) => {
      setPendingPermission(request);
    });
  }, []);

  const handlePermissionResponse = async (allowed: boolean, alwaysAllow: boolean) => {
    if (pendingPermission) {
      await window.electronAPI.respondToPermission(pendingPermission.id, allowed, alwaysAllow);
      setPendingPermission(null);
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          {activeSession ? (
            <ChatWindow session={activeSession} />
          ) : (
            <div className="no-session">
              <div className="no-session-content">
                <div className="welcome-icon">🚀</div>
                <h2>Welcome to Claude Desktop</h2>
                <p>Select a folder to start your first session with Claude</p>
                <div className="welcome-actions">
                  <button
                    className="btn primary large"
                    onClick={createSession}
                  >
                    📁 Select Folder & Create Session
                  </button>
                  {!isSidebarOpen && (
                    <button
                      className="btn outlined large"
                      onClick={toggleSidebar}
                    >
                      📋 Show Sessions Panel
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingPermission && (
        <PermissionDialog
          request={pendingPermission}
          onRespond={handlePermissionResponse}
        />
      )}
    </div>
  );
};

export default App;