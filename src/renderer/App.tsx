import React, { useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import ChatWindow from './components/ChatWindow';
import Sidebar from './components/Sidebar';
import { useSessionStore } from './store/sessionStore';
import type { PermissionRequest } from '../shared/types';

const App: React.FC = () => {
  const { sessions, activeSessionId, initializeSessions, createSession, isSidebarOpen, toggleSidebar } = useSessionStore();
  const permissionListenerRegistered = useRef(false);

  useEffect(() => {
    // Initialize sessions from Electron - only once
    initializeSessions();

    // Register permission request listener only once
    if (!permissionListenerRegistered.current) {
      window.electronAPI.onPermissionRequest((request: PermissionRequest) => {
        // Access the store directly to avoid dependency issues
        useSessionStore.getState().addPermissionRequest(request);
      });
      permissionListenerRegistered.current = true;
    }
  }, []);

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
    </div>
  );
};

export default App;