import React from 'react';
import type { Reference } from '../../shared/types';

interface ReferenceChipProps {
  reference: Reference;
  onRemove: () => void;
}

const ReferenceChip: React.FC<ReferenceChipProps> = ({ reference, onRemove }) => {
  // Get icon for reference kind
  const getIcon = (kind: Reference['kind']) => {
    switch (kind) {
      case 'file':
        return '📄';
      case 'folder':
        return '📁';
      case 'agent':
        return '🤖';
      default:
        return '📎';
    }
  };

  return (
    <div className="file-chip">
      <span className="file-icon">{getIcon(reference.kind)}</span>
      <span className="file-name">{reference.name}</span>
      <button
        className="remove-file-btn"
        onClick={onRemove}
        title="Remove reference"
      >
        ✕
      </button>
    </div>
  );
};

export default ReferenceChip;
