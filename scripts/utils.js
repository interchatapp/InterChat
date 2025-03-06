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

export const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const redText = (/** @type {string} */ text) => `\x1b[0;31m${text}\x1b[0m`;
export const greenText = (/** @type {string} */ text) => `\x1b[38;5;78m${text}\x1b[0m`;
export const greyText = (/** @type {string} */ text) => `\x1b[38;5;246m${text}\x1b[0m`;
export const orangeText = (/** @type {string} */ text) => `\x1b[38;5;208m${text}\x1b[0m`;

const DISCORD_EPOCH = 1420070400000;

export function getTimestampFromSnowflake(snowflake) {
  if (!snowflake || !/^\d+$/.test(snowflake)) {
    throw new Error('Invalid snowflake format');
  }

  const timestamp = Number(BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
  return new Date(timestamp);
}

export function deconstructSnowflake(snowflake) {
  if (!snowflake || !/^\d+$/.test(snowflake)) {
    throw new Error('Invalid snowflake format');
  }

  const snowflakeBigInt = BigInt(snowflake);

  return {
    timestamp: new Date(Number(snowflakeBigInt >> 22n) + DISCORD_EPOCH),
    workerId: Number((snowflakeBigInt & 0x3e0000n) >> 17n),
    processId: Number((snowflakeBigInt & 0x1f000n) >> 12n),
    increment: Number(snowflakeBigInt & 0xfffn),
  };
}

export class Spinner {
  constructor(message = 'Loading...', frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']) {
    this.message = message;
    this.frames = frames;
    this.frameIndex = 0;
    this.intervalId = null;
    this.isSpinning = false;
    this.lastLineLength = 0;
  }

  /**
   *
   * @param {string | null} message
   * @returns {void}
   */
  start(message = null) {
    if (message) this.message = message;
    if (this.isSpinning) return;

    this.isSpinning = true;
    this.frameIndex = 0;
    process.stdout.write('\x1B[?25l'); // Hide cursor

    this.intervalId = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      const terminalWidth = process.stdout.columns || 80;
      const maxTextLength = terminalWidth - 1;
      const text = `${greyText(frame)} ${this.message}`.slice(0, maxTextLength);

      // Clear the current line
      process.stdout.write(`\r\x1B[K${text}`);

      this.lastLineLength = text.length;
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }
  stop(message = '') {
    if (!this.isSpinning) return;

    clearInterval(this.intervalId);
    this.isSpinning = false;

    // Clear the spinner line
    process.stdout.write(`\r${' '.repeat(this.lastLineLength)}\r`);

    if (message) {
      process.stdout.write(`${message}\n`);
    }

    process.stdout.write('\x1B[?25h'); // Show cursor
  }

  update(message) {
    this.message = message;
  }
}
