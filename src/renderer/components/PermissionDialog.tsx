import React, { useState } from 'react';
import type { PermissionRequest } from '../../shared/types';

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void;
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({ request, onRespond }) => {
  const handleDeny = () => {
    onRespond(false, false);
  };

  const handleAllow = () => {
    onRespond(true, false);
  };

  const handleAlwaysAllow = () => {
    onRespond(true, true);
  };

  return (
    <div className="modal-overlay">
      <div className="permission-dialog">
        <div className="permission-header">
          <div className="permission-icon">🔐</div>
          <h3>Permission Required</h3>
        </div>

        <div className="permission-body">
          <p className="permission-message">{request.message}</p>

          <div className="permission-details">
            <div className="detail-row">
              <span className="detail-label">Tool:</span>
              <span className="detail-value">{request.tool}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Path:</span>
              <span className="detail-value path">{request.path}</span>
            </div>
          </div>

          <p className="permission-hint">
            Choose "Accept Always" to save this permission and skip future prompts for this tool.
          </p>
        </div>

        <div className="permission-actions">
          <button className="btn outlined" onClick={handleDeny}>
            Deny
          </button>
          <button className="btn secondary" onClick={handleAllow}>
            Accept Once
          </button>
          <button className="btn primary" onClick={handleAlwaysAllow}>
            Accept Always
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionDialog;