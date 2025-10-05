import React from 'react';

const TitleBar: React.FC = () => {
  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <div className="app-title">Claude</div>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-btn minimize"
          onClick={() => window.electronAPI.minimizeWindow()}
          title="Minimize"
        >
          ─
        </button>
        <button
          className="title-bar-btn maximize"
          onClick={() => window.electronAPI.maximizeWindow()}
          title="Maximize"
        >
          ☐
        </button>
        <button
          className="title-bar-btn close"
          onClick={() => window.electronAPI.closeWindow()}
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default TitleBar;