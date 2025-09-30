import React from 'react';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="btn-icon close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          {/* Placeholder for future app settings */}
        </div>

        <div className="settings-footer">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;