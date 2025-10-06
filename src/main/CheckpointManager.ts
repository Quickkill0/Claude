import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface Checkpoint {
  hash: string;
  message: string;
  timestamp: string;
  author: string;
}

export class CheckpointManager {
  /**
   * Ensure git is initialized in the directory
   */
  private async ensureGitRepo(workingDirectory: string): Promise<void> {
    try {
      // Check if we're already in a git repository
      await execAsync('git rev-parse --git-dir', { cwd: workingDirectory });
      console.log('[CheckpointManager] Git repository already exists');
    } catch (error) {
      // Not a git repo, initialize it
      console.log('[CheckpointManager] No git repository found, initializing...');
      await execAsync('git init', { cwd: workingDirectory });

      // Configure git user if not set (required for commits)
      try {
        await execAsync('git config user.name', { cwd: workingDirectory });
      } catch {
        // User not set, set default
        await execAsync('git config user.name "Claude Code"', { cwd: workingDirectory });
        await execAsync('git config user.email "claude-code@anthropic.com"', { cwd: workingDirectory });
        console.log('[CheckpointManager] Configured default git user');
      }

      console.log('[CheckpointManager] Git repository initialized successfully');
    }
  }

  /**
   * Create a git checkpoint (commit) for the current state
   */
  async createCheckpoint(workingDirectory: string, message: string): Promise<void> {
    try {
      console.log('[CheckpointManager] Creating checkpoint in:', workingDirectory);
      console.log('[CheckpointManager] Message:', message);

      // Ensure git is initialized
      await this.ensureGitRepo(workingDirectory);

      // Stage all changes
      await execAsync('git add -A', { cwd: workingDirectory });

      // Check if there are changes to commit
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workingDirectory });

      if (!statusOutput.trim()) {
        console.log('[CheckpointManager] No changes to checkpoint');
        return;
      }

      // Create commit with checkpoint message - escape quotes properly
      const escapedMessage = message.replace(/"/g, '\\"');
      const commitMessage = `🔖 Checkpoint: ${escapedMessage}\n\nAuto-generated checkpoint from Claude Code`;
      await execAsync(`git commit -m "${commitMessage}"`, { cwd: workingDirectory });

      console.log('[CheckpointManager] Checkpoint created successfully:', message);
    } catch (error: any) {
      // If not a git repo or other error, log but don't fail
      console.error('[CheckpointManager] Error creating checkpoint:', error.message || error);
      console.error('[CheckpointManager] Working directory was:', workingDirectory);
      if (error.message?.includes('not a git repository')) {
        console.log('[CheckpointManager] Not a git repository, skipping checkpoint');
      }
    }
  }

  /**
   * Get list of checkpoints (commits with checkpoint prefix)
   */
  async getCheckpoints(workingDirectory: string): Promise<Checkpoint[]> {
    try {
      // Ensure git is initialized
      await this.ensureGitRepo(workingDirectory);

      // Get all commits with checkpoint prefix
      const { stdout } = await execAsync(
        'git log --all --grep="🔖 Checkpoint:" --pretty=format:"%H|%s|%ai|%an" --date-order',
        { cwd: workingDirectory }
      );

      if (!stdout.trim()) {
        return [];
      }

      const checkpoints: Checkpoint[] = stdout.trim().split('\n').map(line => {
        const [hash, message, timestamp, author] = line.split('|');
        // Remove the checkpoint prefix from message for display
        const cleanMessage = message.replace(/^🔖 Checkpoint:\s*/, '');
        return {
          hash,
          message: cleanMessage,
          timestamp,
          author,
        };
      });

      return checkpoints;
    } catch (error: any) {
      if (error.message?.includes('not a git repository')) {
        console.log('[CheckpointManager] Not a git repository');
        return [];
      }
      console.error('[CheckpointManager] Error getting checkpoints:', error);
      return [];
    }
  }

  /**
   * Restore to a specific checkpoint
   */
  async restoreCheckpoint(workingDirectory: string, checkpointHash: string): Promise<void> {
    try {
      // Ensure git is initialized
      await this.ensureGitRepo(workingDirectory);

      // Check for uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workingDirectory });

      if (statusOutput.trim()) {
        // Stash current changes before restoring
        await execAsync('git stash push -m "Auto-stash before checkpoint restore"', { cwd: workingDirectory });
      }

      // Reset to the checkpoint
      await execAsync(`git reset --hard ${checkpointHash}`, { cwd: workingDirectory });

      console.log('[CheckpointManager] Restored to checkpoint:', checkpointHash);
    } catch (error) {
      console.error('[CheckpointManager] Error restoring checkpoint:', error);
      throw error;
    }
  }

  /**
   * Get the current git status
   */
  async getStatus(workingDirectory: string): Promise<{ isGitRepo: boolean; hasChanges: boolean }> {
    try {
      console.log('[CheckpointManager] Checking git status for:', workingDirectory);

      // Ensure git is initialized
      await this.ensureGitRepo(workingDirectory);

      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workingDirectory });

      return {
        isGitRepo: true,
        hasChanges: statusOutput.trim().length > 0,
      };
    } catch (error: any) {
      console.error('[CheckpointManager] Git status error:', error.message || error);
      console.error('[CheckpointManager] Working directory was:', workingDirectory);
      return {
        isGitRepo: false,
        hasChanges: false,
      };
    }
  }
}
