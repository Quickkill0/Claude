import React from 'react';
import { useSessionStore } from '../store/sessionStore';

const TitleBar: React.FC = () => {
  const { toggleSidebar, isSidebarOpen } = useSessionStore();

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {isSidebarOpen ? '◀' : '▶'}
        </button>
        <div className="app-icon">🤖</div>
        <div className="app-title">Claude Desktop</div>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-btn minimize"
          onClick={() => window.electronAPI.minimizeWindow()}
          title="Minimize"
        >
          −
        </button>
        <button
          className="title-bar-btn maximize"
          onClick={() => window.electronAPI.maximizeWindow()}
          title="Maximize"
        >
          □
        </button>
        <button
          className="title-bar-btn close"
          onClick={() => window.electronAPI.closeWindow()}
          title="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default TitleBar;