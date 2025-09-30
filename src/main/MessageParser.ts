/**
 * MessageParser - Centralized parser for Claude streaming JSON data
 * Handles all message types and content blocks from Claude CLI
 */

import { Message, ClaudeStreamData } from '../shared/types';
import * as crypto from 'crypto';
import { ErrorHandler } from './ErrorHandler';

export interface ParsedMessage {
  message: Message | null;
  updates?: Partial<Message>;
  sessionUpdate?: {
    claudeSessionId?: string;
    isProcessing?: boolean;
  };
  stats?: {
    cost?: number;
    tokens?: { input: number; output: number };
  };
}

export class MessageParser {
  private currentContentBlocks: Map<string, Map<string, any>> = new Map();
  private messageIds: Map<string, string> = new Map();

  /**
   * Parse incoming Claude stream data
   */
  parseStreamData(sessionId: string, data: ClaudeStreamData): ParsedMessage[] {
    try {
      const results: ParsedMessage[] = [];

      switch (data.type) {
        case 'system':
          results.push(...this.handleSystemMessage(sessionId, data));
          break;
        case 'assistant':
          results.push(...this.handleAssistantMessage(sessionId, data));
          break;
        case 'user':
          results.push(...this.handleUserMessage(sessionId, data));
          break;
        case 'result':
          results.push(...this.handleResultMessage(sessionId, data));
          break;
        default:
          console.warn('[MessageParser] Unknown message type:', data.type);
      }

      return results;
    } catch (error) {
      const { message, details } = ErrorHandler.handleParseError(error, data);
      return [
        {
          message: this.createMessage(
            sessionId,
            'error',
            ErrorHandler.formatError({ message, details })
          ),
        },
      ];
    }
  }

  /**
   * Handle system messages (initialization, errors, etc.)
   */
  private handleSystemMessage(sessionId: string, data: ClaudeStreamData): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    if (data.subtype === 'init') {
      // Session initialization
      if (data.session_id) {
        results.push({
          message: null,
          sessionUpdate: {
            claudeSessionId: data.session_id,
          },
        });
      }
    } else if (data.subtype === 'error') {
      // Error message
      results.push({
        message: this.createMessage(sessionId, 'error', data.message?.content || 'An error occurred'),
      });
    } else {
      // Generic system message
      results.push({
        message: this.createMessage(sessionId, 'system', data.message?.content || ''),
      });
    }

    return results;
  }

  /**
   * Handle assistant messages (text, thinking, tool_use)
   */
  private handleAssistantMessage(sessionId: string, data: ClaudeStreamData): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    // Handle content blocks
    if (data.message?.content) {
      const contentBlocks = Array.isArray(data.message.content)
        ? data.message.content
        : [data.message.content];

      for (const block of contentBlocks) {
        const parsed = this.parseContentBlock(sessionId, block, data);
        if (parsed) {
          results.push(parsed);
        }
      }
    }

    // Handle delta updates
    if (data.subtype === 'content_block_delta' && data.message?.delta) {
      const delta = data.message.delta;
      const index = data.message.index ?? 0;

      const blockKey = `${sessionId}-${index}`;

      if (delta.type === 'text_delta' && delta.text) {
        // Accumulate text deltas
        if (!this.currentContentBlocks.has(blockKey)) {
          this.currentContentBlocks.set(blockKey, new Map());
        }

        const blocks = this.currentContentBlocks.get(blockKey)!;
        const currentText = blocks.get('text') || '';
        blocks.set('text', currentText + delta.text);

        const messageId = this.messageIds.get(blockKey);
        if (messageId) {
          results.push({
            message: null,
            updates: {
              id: messageId,
              content: blocks.get('text'),
            },
          });
        }
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        // Accumulate thinking deltas
        if (!this.currentContentBlocks.has(blockKey)) {
          this.currentContentBlocks.set(blockKey, new Map());
        }

        const blocks = this.currentContentBlocks.get(blockKey)!;
        const currentThinking = blocks.get('thinking') || '';
        blocks.set('thinking', currentThinking + delta.thinking);

        const messageId = this.messageIds.get(blockKey);
        if (messageId) {
          results.push({
            message: null,
            updates: {
              id: messageId,
              content: blocks.get('thinking'),
            },
          });
        }
      }
    }

    // Handle content block start
    if (data.subtype === 'content_block_start' && data.message?.content_block) {
      const block = data.message.content_block;
      const index = data.message.index ?? 0;
      const blockKey = `${sessionId}-${index}`;

      // Initialize content block
      this.currentContentBlocks.set(blockKey, new Map());

      // Create initial message
      const parsed = this.parseContentBlock(sessionId, block, data);
      if (parsed && parsed.message) {
        this.messageIds.set(blockKey, parsed.message.id);
        results.push(parsed);
      }
    }

    // Handle content block stop
    if (data.subtype === 'content_block_stop') {
      const index = data.message?.index ?? 0;
      const blockKey = `${sessionId}-${index}`;

      // Clean up
      this.currentContentBlocks.delete(blockKey);
      this.messageIds.delete(blockKey);
    }

    return results;
  }

  /**
   * Handle user messages (tool results)
   */
  private handleUserMessage(sessionId: string, data: ClaudeStreamData): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    if (data.message?.content) {
      const contentBlocks = Array.isArray(data.message.content)
        ? data.message.content
        : [data.message.content];

      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const toolName = this.extractToolName(block.tool_use_id);
          const isError = block.is_error || false;
          const content = this.formatToolResult(block.content);

          results.push({
            message: this.createMessage(
              sessionId,
              'tool-result',
              content,
              {
                toolName,
                isError,
              }
            ),
          });
        }
      }
    }

    return results;
  }

  /**
   * Handle result messages (final response with stats)
   */
  private handleResultMessage(sessionId: string, data: ClaudeStreamData): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    if (data.subtype === 'success') {
      // Extract usage stats
      if (data.usage) {
        results.push({
          message: null,
          sessionUpdate: {
            isProcessing: false,
          },
          stats: {
            tokens: {
              input: data.usage.input_tokens || 0,
              output: data.usage.output_tokens || 0,
            },
            cost: this.calculateCost(data.usage, data.model),
          },
        });
      }
    } else if (data.subtype === 'error') {
      results.push({
        message: this.createMessage(
          sessionId,
          'error',
          data.error?.message || 'An error occurred'
        ),
        sessionUpdate: {
          isProcessing: false,
        },
      });
    }

    return results;
  }

  /**
   * Parse individual content block
   */
  private parseContentBlock(sessionId: string, block: any, data: ClaudeStreamData): ParsedMessage | null {
    if (!block || !block.type) return null;

    switch (block.type) {
      case 'text':
        return {
          message: this.createMessage(sessionId, 'assistant', block.text || ''),
        };

      case 'thinking':
        return {
          message: this.createMessage(sessionId, 'thinking', block.thinking || ''),
        };

      case 'tool_use':
        return {
          message: this.createMessage(
            sessionId,
            'tool',
            JSON.stringify(block.input || {}, null, 2),
            {
              toolName: block.name,
              rawInput: block.input,
            }
          ),
        };

      default:
        console.warn('[MessageParser] Unknown content block type:', block.type);
        return null;
    }
  }

  /**
   * Format tool result content
   */
  private formatToolResult(content: any): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item.type === 'text') {
            return item.text;
          }
          return JSON.stringify(item);
        })
        .join('\n');
    }

    if (content && typeof content === 'object') {
      if (content.type === 'text') {
        return content.text || '';
      }
      return JSON.stringify(content, null, 2);
    }

    return String(content);
  }

  /**
   * Extract tool name from tool_use_id
   */
  private extractToolName(toolUseId?: string): string {
    // Tool use IDs might contain tool name info, but for now just return unknown
    return 'Unknown';
  }

  /**
   * Calculate cost based on usage
   */
  private calculateCost(usage: any, model?: string): number {
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;

    // Pricing per 1M tokens (as of 2025)
    let inputCost = 0;
    let outputCost = 0;

    if (model?.includes('opus')) {
      inputCost = 15; // $15 per 1M input tokens
      outputCost = 75; // $75 per 1M output tokens
    } else if (model?.includes('sonnet')) {
      inputCost = 3; // $3 per 1M input tokens
      outputCost = 15; // $15 per 1M output tokens
    } else {
      inputCost = 3;
      outputCost = 15;
    }

    const totalCost = (inputTokens * inputCost + outputTokens * outputCost) / 1_000_000;
    return Math.round(totalCost * 10000) / 10000; // Round to 4 decimal places
  }

  /**
   * Create a message object
   */
  private createMessage(
    sessionId: string,
    type: Message['type'],
    content: string,
    metadata?: Message['metadata']
  ): Message {
    return {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      type,
      content,
      metadata,
    };
  }

  /**
   * Clear state for a session
   */
  clearSession(sessionId: string): void {
    // Clear all blocks for this session
    const keysToDelete: string[] = [];
    for (const key of this.currentContentBlocks.keys()) {
      if (key.startsWith(sessionId)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.currentContentBlocks.delete(key);
      this.messageIds.delete(key);
    }
  }
}
