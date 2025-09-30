import React, { useState } from 'react';
import type { PermissionRequest } from '../../shared/types';

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void;
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({ request, onRespond }) => {
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  const handleAllow = () => {
    onRespond(true, alwaysAllow);
  };

  const handleDeny = () => {
    onRespond(false, false);
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

          <label className="permission-checkbox">
            <input
              type="checkbox"
              checked={alwaysAllow}
              onChange={(e) => setAlwaysAllow(e.target.checked)}
            />
            <span>Always allow this tool for this path</span>
          </label>
        </div>

        <div className="permission-actions">
          <button className="btn outlined" onClick={handleDeny}>
            Deny
          </button>
          <button className="btn primary" onClick={handleAllow}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionDialog;