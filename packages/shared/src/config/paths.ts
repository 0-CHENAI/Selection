/**
 * Centralized path configuration for Selection.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-agents-1), the detect-instance
 * script can set CRAFT_CONFIG_DIR to ~/.selection-1, allowing multiple instances
 * to run simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.selection/
 * Instance 1 (-1 suffix): ~/.selection-1/
 * Instance 2 (-2 suffix): ~/.selection-2/
 *
 * Legacy installs used ~/.craft-agent — set CRAFT_CONFIG_DIR=~/.craft-agent
 * to keep using old data without moving files.
 */

import { homedir } from 'os';
import { join } from 'path';

/** Default directory name under the user home for all app data. */
export const DEFAULT_CONFIG_DIR_NAME = '.selection';

// Allow override via environment variable for multi-instance dev / legacy paths.
// Falls back to default ~/.selection/ for production and non-numbered dev folders.
export const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || join(homedir(), DEFAULT_CONFIG_DIR_NAME);
