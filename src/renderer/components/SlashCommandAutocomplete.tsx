import React, { useEffect, useRef } from 'react';
import type { SlashCommand } from '../../shared/types';

interface SlashCommandAutocompleteProps {
  commands: SlashCommand[];
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const SlashCommandAutocomplete: React.FC<SlashCommandAutocompleteProps> = ({
  commands,
  query,
  onSelect,
  onClose,
  position,
}) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter and sort commands based on query
  const filteredCommands = React.useMemo(() => {
    let filtered = commands;

    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = commands.filter((cmd) => {
        return (
          cmd.name.toLowerCase().includes(lowerQuery) ||
          cmd.description?.toLowerCase().includes(lowerQuery)
        );
      });
    }

    // Sort: built-in first, then project, then personal
    const sourceOrder = { builtin: 0, project: 1, personal: 2 };
    return filtered.sort((a, b) => {
      const sourceCompare = sourceOrder[a.source] - sourceOrder[b.source];
      if (sourceCompare !== 0) return sourceCompare;
      return a.name.localeCompare(b.name);
    });
  }, [commands, query]);

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredCommands.length === 0) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex]);
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
  }, [filteredCommands, selectedIndex, onSelect, onClose]);

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

  if (filteredCommands.length === 0) {
    return (
      <div
        ref={containerRef}
        className="slash-command-autocomplete"
        style={{ top: position.top, left: position.left }}
      >
        <div className="autocomplete-empty">No commands found</div>
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
        Slash Commands ({filteredCommands.length})
      </div>
      <div className="autocomplete-list">
        {filteredCommands.map((command, index) => (
          <div
            key={`${command.source}-${command.name}`}
            className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
            data-source={command.source}
            onClick={() => onSelect(command)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="command-name">
              /{command.name}
              {command.argumentHint && (
                <span className="command-args"> {command.argumentHint}</span>
              )}
            </div>
            {command.description && (
              <div className="command-description">{command.description}</div>
            )}
            <div className="command-source">
              {command.source === 'builtin' ? '⚡ Built-in' : command.source === 'project' ? '📁 Project' : '👤 Personal'}
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

export default SlashCommandAutocomplete;
