import React, { useEffect, useRef } from 'react';
import type { Reference } from '../../shared/types';

interface ReferenceAutocompleteProps {
  references: Reference[];
  query: string;
  onSelect: (reference: Reference) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const ReferenceAutocomplete: React.FC<ReferenceAutocompleteProps> = ({
  references,
  query,
  onSelect,
  onClose,
  position,
}) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Filter and sort references based on query
  const filteredReferences = React.useMemo(() => {
    let filtered = references;

    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = references.filter((ref) => {
        return (
          ref.name.toLowerCase().includes(lowerQuery) ||
          ref.path.toLowerCase().includes(lowerQuery) ||
          ref.description?.toLowerCase().includes(lowerQuery)
        );
      });
    }

    // Sort: agents first, then folders, then files
    const kindOrder = { agent: 0, folder: 1, file: 2 };
    return filtered.sort((a, b) => {
      const kindCompare = kindOrder[a.kind] - kindOrder[b.kind];
      if (kindCompare !== 0) return kindCompare;
      return a.name.localeCompare(b.name);
    });
  }, [references, query]);

  // Reset selected index when filtered references change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredReferences]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredReferences.length === 0) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredReferences.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredReferences.length) % filteredReferences.length);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (filteredReferences[selectedIndex]) {
            onSelect(filteredReferences[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredReferences, selectedIndex, onSelect, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (filteredReferences.length === 0) {
    return (
      <div
        ref={containerRef}
        className="slash-command-autocomplete"
        style={{ top: position.top, left: position.left }}
      >
        <div className="autocomplete-empty">No references found</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="slash-command-autocomplete"
      style={{ top: position.top, left: position.left }}
    >
      <div className="autocomplete-header">
        References ({filteredReferences.length})
      </div>
      <div className="autocomplete-list">
        {filteredReferences.map((reference, index) => (
          <div
            key={`${reference.kind}-${reference.path}`}
            className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
            data-source={reference.kind}
            onClick={() => onSelect(reference)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="command-name">
              {getIcon(reference.kind)} {reference.name}
            </div>
            {reference.description && (
              <div className="command-description">{reference.description}</div>
            )}
            <div className="command-source">
              {reference.kind === 'file' ? 'File' : reference.kind === 'folder' ? 'Folder' : 'Agent'}
              {' • '}
              {reference.path}
            </div>
          </div>
        ))}
      </div>
      <div className="autocomplete-footer">
        ↑↓ Navigate • ↵ Select • Esc Close
      </div>
    </div>
  );
};

export default ReferenceAutocomplete;
