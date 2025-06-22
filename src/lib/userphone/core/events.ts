/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import { EventEmitter } from 'events';
import type { CallEvents } from './types.js';
import Logger from '#src/utils/Logger.js';

/**
 * Type-safe event emitter for call system events
 */
export class CallEventEmitter extends EventEmitter {
  emit<K extends keyof CallEvents>(event: K, data: CallEvents[K]): boolean {
    return super.emit(event, data);
  }

  on<K extends keyof CallEvents>(
    event: K,
    listener: (data: CallEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof CallEvents>(
    event: K,
    listener: (data: CallEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  off<K extends keyof CallEvents>(
    event: K,
    listener: (data: CallEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Global event bus for the calling system
 */
export const callEventBus = new CallEventEmitter();

/**
 * Event handler interface for services that need to react to call events
 */
export interface ICallEventHandler {
  /**
   * Handle call events
   */
  handleEvent<K extends keyof CallEvents>(event: K, data: CallEvents[K]): Promise<void>;
}

/**
 * Base class for services that handle call events
 */
export abstract class CallEventHandler implements ICallEventHandler {
  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for this handler
   */
  protected abstract setupEventListeners(): void;

  /**
   * Handle call events
   */
  abstract handleEvent<K extends keyof CallEvents>(event: K, data: CallEvents[K]): Promise<void>;

  /**
   * Subscribe to a specific event
   */
  protected subscribe<K extends keyof CallEvents>(
    event: K,
    handler: (data: CallEvents[K]) => Promise<void>,
  ): void {
    callEventBus.on(event, handler);
  }

  /**
   * Emit an event
   */
  protected emit<K extends keyof CallEvents>(event: K, data: CallEvents[K]): void {
    callEventBus.emit(event, data);
  }
}

/**
 * Simplified event middleware - essential logging only
 */
export class CallEventMiddleware extends CallEventHandler {
  protected setupEventListeners(): void {
    // Only log essential events to reduce overhead
    this.subscribe('call:matched', async (data) => {
      Logger.debug(`[CallEvent] Match found: ${data.call.id}`);
    });

    this.subscribe('call:ended', async (data) => {
      Logger.debug(`[CallEvent] Call ended: ${data.call.id}`);
    });
  }

  async handleEvent<K extends keyof CallEvents>(_event: K, _data: CallEvents[K]): Promise<void> {
    // Simplified implementation
  }
}
