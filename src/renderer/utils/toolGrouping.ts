/**
 * Tool Grouping Logic
 * Groups sequential related tool calls into logical operations
 */

import type { Message } from '../../shared/types';

export interface ToolGroup {
  id: string;
  type: 'single' | 'operation';
  messages: Message[];
  summary: string;
  icon: string;
  startTime: string;
  endTime: string;
}

/**
 * Groups tool messages into logical operations
 * Example: Read → Edit → Write on same file = "Modified file.ts"
 */
export function groupToolMessages(messages: Message[]): ToolGroup[] {
  const groups: ToolGroup[] = [];

  // First pass: Build map of toolUseId -> tool message for matching results
  const toolUseIdMap = new Map<string, Message>();
  const processedIds = new Set<string>();

  for (const msg of messages) {
    if (msg.type === 'tool' && msg.metadata?.toolUseId) {
      toolUseIdMap.set(msg.metadata.toolUseId, msg);
    }
  }

  const createGroup = (msgs: Message[]): ToolGroup => {
    if (msgs.length === 0) {
      throw new Error('Cannot create group from empty messages');
    }

    // Check if it's a file operation sequence
    const fileOp = detectFileOperation(msgs);
    if (fileOp) {
      return {
        id: `group-${msgs[0].id}`,
        type: 'operation',
        messages: msgs,
        summary: fileOp.summary,
        icon: fileOp.icon,
        startTime: msgs[0].timestamp,
        endTime: msgs[msgs.length - 1].timestamp
      };
    }

    // Single tool or unrelated sequence
    const firstMsg = msgs[0];
    const toolName = firstMsg.metadata?.toolName || 'Tool';

    return {
      id: `group-${msgs[0].id}`,
      type: msgs.length === 1 ? 'single' : 'operation',
      messages: msgs,
      summary: msgs.length === 1 ? getSingleToolSummary(firstMsg) : `${toolName} operations (${msgs.length})`,
      icon: getToolIcon(toolName),
      startTime: msgs[0].timestamp,
      endTime: msgs[msgs.length - 1].timestamp
    };
  };

  // Second pass: Group messages, handling separated tool-results
  let currentGroup: Message[] = [];
  let lastToolTarget: string | null = null;
  let lastToolTime: number = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Skip if already processed as part of a tool+result pair
    if (processedIds.has(msg.id)) {
      continue;
    }

    // Only group tool and tool-result messages
    if (msg.type !== 'tool' && msg.type !== 'tool-result') {
      if (currentGroup.length > 0) {
        groups.push(createGroup(currentGroup));
        currentGroup = [];
        lastToolTarget = null;
      }
      continue;
    }

    const toolName = msg.metadata?.toolName;
    const target = extractToolTarget(msg);
    const msgTime = new Date(msg.timestamp).getTime();

    // For tool messages, collect them with their corresponding result
    if (msg.type === 'tool') {
      const toolMessages: Message[] = [msg];
      processedIds.add(msg.id);

      // Find the corresponding tool-result (might not be immediately after)
      if (msg.metadata?.toolUseId) {
        for (let j = i + 1; j < messages.length; j++) {
          const potentialResult = messages[j];
          if (potentialResult.type === 'tool-result' &&
              potentialResult.metadata?.toolUseId === msg.metadata.toolUseId) {
            toolMessages.push(potentialResult);
            processedIds.add(potentialResult.id);
            break; // Found the result, stop looking
          }
        }
      }

      // Check if this tool should be grouped with previous ones (same file operations)
      const shouldGroup =
        currentGroup.length > 0 &&
        toolName &&
        target &&
        lastToolTarget === target &&
        (msgTime - lastToolTime) < 30000; // Within 30 seconds (increased from 10)

      if (shouldGroup) {
        currentGroup.push(...toolMessages);
      } else {
        if (currentGroup.length > 0) {
          groups.push(createGroup(currentGroup));
        }
        currentGroup = toolMessages;
        lastToolTarget = target;
      }

      lastToolTime = msgTime;
    }
    // Orphan tool-result (shouldn't happen, but handle it)
    else if (msg.type === 'tool-result') {
      // Try to find its tool
      const correspondingTool = msg.metadata?.toolUseId ? toolUseIdMap.get(msg.metadata.toolUseId) : null;

      if (!correspondingTool || !processedIds.has(msg.id)) {
        // Standalone result (shouldn't happen but handle gracefully)
        if (currentGroup.length > 0) {
          groups.push(createGroup(currentGroup));
          currentGroup = [];
        }
        groups.push(createGroup([msg]));
        processedIds.add(msg.id);
      }
    }
  }

  // Add remaining group
  if (currentGroup.length > 0) {
    groups.push(createGroup(currentGroup));
  }

  return groups;
}

/**
 * Extracts the target (file path, URL, etc.) from a tool message
 */
function extractToolTarget(msg: Message): string | null {
  try {
    const toolName = msg.metadata?.toolName;
    if (!toolName) return null;

    // For tool-result messages, look at rawInput metadata
    if (msg.type === 'tool-result' && msg.metadata?.rawInput) {
      const input = msg.metadata.rawInput;
      return input.file_path || input.url || input.path || null;
    }

    // For tool messages, parse content
    const input = JSON.parse(msg.content);
    return input.file_path || input.url || input.path || null;
  } catch {
    return null;
  }
}

/**
 * Detects file operations (Read → Edit → Write sequences)
 */
function detectFileOperation(msgs: Message[]): { summary: string; icon: string } | null {
  if (msgs.length < 2) return null;

  const tools = msgs.map(m => m.metadata?.toolName).filter(Boolean);
  const firstMsg = msgs[0];
  const filePath = extractToolTarget(firstMsg);

  if (!filePath) return null;

  const fileName = filePath.split(/[/\\]/).pop() || 'file';

  // Check for common patterns
  if (tools.includes('Read') && tools.includes('Edit')) {
    return {
      summary: `Modified ${fileName} (${msgs.length} steps)`,
      icon: '✏️'
    };
  }

  if (tools.includes('Write') && !tools.includes('Read')) {
    return {
      summary: `Created ${fileName}`,
      icon: '📝'
    };
  }

  if (tools.includes('Read') && tools.length === 2) {
    return {
      summary: `Read ${fileName}`,
      icon: '📖'
    };
  }

  return null;
}

/**
 * Gets a summary for a single tool message
 */
function getSingleToolSummary(msg: Message): string {
  const toolName = msg.metadata?.toolName || 'Tool';

  switch (toolName) {
    case 'Edit':
      return 'Edited file';
    case 'Write':
      return 'Created file';
    case 'Read':
      return 'Read file';
    case 'Bash':
      return 'Ran command';
    case 'Grep':
      return 'Searched code';
    case 'Glob':
      return 'Found files';
    case 'TodoWrite':
      return 'Updated tasks';
    case 'WebSearch':
      return 'Searched web';
    default:
      return toolName;
  }
}

/**
 * Gets icon for a tool
 */
function getToolIcon(toolName: string): string {
  switch (toolName) {
    case 'Edit':
      return '✏️';
    case 'Write':
      return '📝';
    case 'Read':
      return '📖';
    case 'Bash':
      return '⚡';
    case 'Grep':
      return '🔍';
    case 'Glob':
      return '📁';
    case 'TodoWrite':
      return '✓';
    case 'WebSearch':
    case 'WebFetch':
      return '🌐';
    case 'Task':
      return '🤖';
    default:
      return '🔧';
  }
}
