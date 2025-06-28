/*
 * Copyright (C) 2025 InterChat
 *
 * TurboLogger - Simple, Reliable Logging Solution
 * A clean, efficient logging system designed for InterChat's needs.
 *
 * Features:
 * - Four log levels: debug, info, warn, error
 * - Colored console output
 * - File logging capability
 * - 100% backward compatibility
 * - Proper resource cleanup for clean shutdown
 * - No background processes or timers
 */

/* eslint-disable no-console */

import { writeFileSync, mkdirSync } from 'node:fs';
import { format } from 'node:util';

const COLORS = {
  RESET: '\x1b[0m',

  // Level colors
  DEBUG: '\x1b[2;37m', // Dim gray
  INFO: '\x1b[36m', // Cyan
  WARN: '\x1b[33m', // Yellow
  ERROR: '\x1b[31m', // Red

  // Accent colors
  TIMESTAMP: '\x1b[2;37m', // Dim gray
  BRACKET: '\x1b[2;90m', // Dark gray
  ARROW: '\x1b[2;36m', // Dim cyan

  // Visual elements
  SUCCESS: '\x1b[32m', // Green
  HIGHLIGHT: '\x1b[35m', // Magenta
} as const;

const SYMBOLS = {
  DEBUG: '🔍',
  INFO: '📘',
  WARN: '⚠️ ',
  ERROR: '🚨',
  PERFORMANCE: '⚡',
  CACHE: '💾',
  DATABASE: '🗄️ ',
  NETWORK: '🌐',
  ARROW: '→',
} as const;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface TurboLoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFileLogging: boolean;
  logDirectory: string;
  enableVisualEnhancements: boolean;
}

// Default configuration
const DEFAULT_CONFIG: TurboLoggerConfig = {
  level: process.env.DEBUG === 'true' ? LogLevel.DEBUG : LogLevel.INFO,
  enableConsole: true,
  enableFileLogging: true,
  logDirectory: 'logs',
  enableVisualEnhancements: true,
};

const LEVEL_CONFIG = {
  [LogLevel.DEBUG]: {
    name: 'DEBUG',
    color: COLORS.DEBUG,
    symbol: SYMBOLS.DEBUG,
  },
  [LogLevel.INFO]: {
    name: 'INFO',
    color: COLORS.INFO,
    symbol: SYMBOLS.INFO,
  },
  [LogLevel.WARN]: {
    name: 'WARN',
    color: COLORS.WARN,
    symbol: SYMBOLS.WARN,
  },
  [LogLevel.ERROR]: {
    name: 'ERROR',
    color: COLORS.ERROR,
    symbol: SYMBOLS.ERROR,
  },
} as const;

// Global shutdown handler to prevent multiple instances from interfering
let globalShutdownHandled = false;

/**
 * TurboLogger - Simple, Reliable Logging Engine
 *
 * Designed for reliability and clean shutdown:
 * - Simple, efficient file I/O
 * - No background timers or intervals
 * - Proper resource cleanup
 * - 100% backward compatibility
 */
export class TurboLogger {
  private config: TurboLoggerConfig;
  private pendingLogs: string[] = [];

  constructor(config: Partial<TurboLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureLogDirectory();

    // Setup global shutdown handler only once
    this.setupGlobalShutdown();
  }

  /**
   * Setup global shutdown handler only once per process
   */
  private setupGlobalShutdown(): void {
    if (globalShutdownHandled) return;

    // Mark as handled to prevent multiple handlers
    globalShutdownHandled = true;

    // Simple shutdown handler that flushes all pending logs
    const handleShutdown = () => {
      // Flush any pending logs synchronously
      this.flushPendingLogs();
    };

    process.on('beforeExit', handleShutdown);
    process.on('exit', handleShutdown);
  }

  private ensureLogDirectory(): void {
    try {
      mkdirSync(this.config.logDirectory, { recursive: true });
    }
    catch {
      // Directory already exists or creation failed - ignore
    }
  }

  /**
   * Simple timestamp generation
   */
  private generateTimestamp(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear() % 100).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year}-${hours}:${minutes}:${seconds}`;
  }

  /**
   * Simple object formatting
   */
  private formatObject(obj: unknown): string {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';

    if (typeof obj === 'object') {
      try {
        return JSON.stringify(obj, null, 2);
      }
      catch {
        return String(obj);
      }
    }

    return String(obj);
  }

  /**
   * Simple message formatting with Winston compatibility
   */
  private formatMessage(message: string, args: unknown[]): string {
    if (args.length === 0) return message;

    // Use Node.js util.format for compatibility
    return format(message, ...args);
  }

  /**
   * Create console output with visual improvements
   */
  private createConsoleOutput(level: LogLevel, message: string, timestamp: string): string {
    const levelConfig = LEVEL_CONFIG[level];

    if (!this.config.enableVisualEnhancements) {
      // Simple format for compatibility
      return `${COLORS.TIMESTAMP}${timestamp}${COLORS.RESET} ${levelConfig.color}${levelConfig.name}${COLORS.RESET}: ${message}`;
    }

    const symbol = levelConfig.symbol;
    const levelName = levelConfig.name;
    const color = levelConfig.color;

    // Detect special message types for enhanced formatting
    let enhancedMessage = message;

    // Performance timing messages
    if (message.includes('ms') && (message.includes('took') || message.includes('in'))) {
      enhancedMessage = message.replace(
        /(\d+(?:\.\d+)?ms)/g,
        `${COLORS.HIGHLIGHT}$1${COLORS.RESET}`,
      );
      enhancedMessage = `${SYMBOLS.PERFORMANCE} ${enhancedMessage}`;
    }
    // Cache operations
    else if (message.includes('cache')) {
      enhancedMessage = `${SYMBOLS.CACHE} ${message}`;
      if (message.includes('HIT')) {
        enhancedMessage = enhancedMessage.replace(/HIT/g, `${COLORS.SUCCESS}HIT${COLORS.RESET}`);
      }
      if (message.includes('MISS')) {
        enhancedMessage = enhancedMessage.replace(/MISS/g, `${COLORS.WARN}MISS${COLORS.RESET}`);
      }
    }
    // Database operations
    else if (message.includes('database') || message.includes('DB') || message.includes('query')) {
      enhancedMessage = `${SYMBOLS.DATABASE} ${message}`;
    }
    // Network operations
    else if (
      message.includes('API') ||
      message.includes('request') ||
      message.includes('response')
    ) {
      enhancedMessage = `${SYMBOLS.NETWORK} ${message}`;
    }

    return `${COLORS.BRACKET}[${COLORS.TIMESTAMP}${timestamp}${COLORS.BRACKET}]${COLORS.RESET} ${symbol} ${color}${levelName}${COLORS.RESET} ${COLORS.ARROW}${SYMBOLS.ARROW}${COLORS.RESET} ${enhancedMessage}`;
  }

  /**
   * Create file output without colors
   */
  private createFileOutput(level: LogLevel, message: string, timestamp: string): string {
    const levelName = LEVEL_CONFIG[level].name;
    return `${timestamp} ${levelName}: ${message}`;
  }

  /**
   * Core logging method - simple and reliable
   */
  private log(level: LogLevel, message: string | Error, args: unknown[]): void {
    // Early exit for disabled levels
    if (level < this.config.level) return;

    // Format message
    const formattedMessage = this.formatMessage(
      message instanceof Error ? message.message : message,
      args,
    );
    const timestamp = this.generateTimestamp();

    // Console output (immediate)
    if (this.config.enableConsole) {
      let messageToLog: string | Error = this.createConsoleOutput(
        level,
        message instanceof Error ? message.message : formattedMessage,
        timestamp,
      );

      // Discord.js errors contain more info, preserve the full object
      if (message instanceof Error) {
        message.message = messageToLog;
        messageToLog = message;
      }

      if (level === LogLevel.ERROR) console.error(messageToLog);
      else console.log(messageToLog);
    }

    // File output (immediate write for simplicity)
    if (this.config.enableFileLogging) {
      const fileOutput = this.createFileOutput(level, formattedMessage, timestamp);
      this.pendingLogs.push(fileOutput);

      // Write immediately if we have too many pending logs
      if (this.pendingLogs.length >= 5) {
        this.flushPendingLogs();
      }
    }
  }

  /**
   * Flush pending logs to files
   */
  private flushPendingLogs(): void {
    if (this.pendingLogs.length === 0) return;

    const logs = this.pendingLogs.splice(0); // Take all pending logs

    try {
      // Write to combined log file
      const logContent = `${logs.join('\n')}\n`;
      const logPath = `${this.config.logDirectory}/combined.log`;

      writeFileSync(logPath, logContent, { flag: 'a' });
    }
    catch (error) {
      // Fallback: log to console if file write fails
      console.error('TurboLogger: Failed to write log file:', error);
    }
  }

  // Public API methods (Winston-compatible)

  /**
   * Debug level logging
   */
  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, args);
  }

  /**
   * Info level logging
   */
  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, args);
  }

  /**
   * Warning level logging
   */
  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, args);
  }

  /**
   * Error level logging with enhanced error handling
   */
  error(message: string | Error | unknown, ...args: unknown[]): void {
    if (message instanceof Error) {
      this.log(LogLevel.ERROR, message, args);
    }
    else if (typeof message === 'string') {
      this.log(LogLevel.ERROR, message, args);
    }
    else {
      this.log(LogLevel.ERROR, this.formatObject(message), args);
    }
  }

  /**
   * Set log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Check if log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  /**
   * Get current configuration
   */
  getConfig(): TurboLoggerConfig {
    return { ...this.config };
  }

  /**
   * Force flush all pending logs
   */
  forceFlush(): void {
    this.flushPendingLogs();
  }
}
