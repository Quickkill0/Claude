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

    // Load and apply theme settings
    loadAndApplyTheme();

    // Register permission request listener only once
    if (!permissionListenerRegistered.current) {
      window.electronAPI.onPermissionRequest((request: PermissionRequest) => {
        // Access the store directly to avoid dependency issues
        useSessionStore.getState().addPermissionRequest(request);
      });
      permissionListenerRegistered.current = true;
    }
  }, []);

  const loadAndApplyTheme = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      applyTheme(settings.theme);
    } catch (error) {
      console.error('Failed to load theme:', error);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'auto') => {
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.body.setAttribute('data-theme', theme);
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
                <h2>Welcome to Claude</h2>
                <p>Select a folder to start your first session</p>
                <div className="welcome-actions">
                  <button
                    className="btn primary large"
                    onClick={createSession}
                  >
                    📁 Select Folder & Create Session
                  </button>
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