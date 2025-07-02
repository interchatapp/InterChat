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

import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';

// Re-export EmojiKeys for use in other files
export type { EmojiKeys };
import {
  type Client,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

interface ButtonConfig {
  label: string;
  customId?: string;
  url?: string;
  emoji?: EmojiKeys | (string & {});
  style?: ButtonStyle;
}

/**
 * InterChat Design System
 *
 * This file contains the design system for InterChat v5, with
 * consistent UI components, colors, and patterns across the application.
 */
export class UIComponents {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Safely sets emoji on a button with fallback handling
   */
  private _setButtonEmoji(button: ButtonBuilder, emoji: EmojiKeys | (string & {})): void {
    try {
      if (typeof emoji === 'string') {
        if (emoji.length <= 2 || emoji.startsWith('�')) {
          button.setEmoji({ name: emoji });
        }
        else {
          button.setEmoji(getEmoji(emoji as EmojiKeys, this.client));
        }
      }
      else if (typeof emoji === 'object' && 'name' in emoji) {
        button.setEmoji(emoji);
      }
    }
    catch {
      // Fallback to no emoji if not found
    }
  }

  /**
   * Creates a button with the given configuration
   */
  private _createButton(config: ButtonConfig): ButtonBuilder {
    const button = new ButtonBuilder().setLabel(config.label);

    if (config.url) {
      button.setStyle(ButtonStyle.Link).setURL(config.url);
    }
    else if (config.customId) {
      button.setCustomId(config.customId).setStyle(config.style || ButtonStyle.Primary);
    }
    else {
      throw new Error('Either customId or url must be provided for a button');
    }

    if (config.emoji) {
      this._setButtonEmoji(button, config.emoji);
    }

    return button;
  }

  /**
   * Creates a text display with optional emoji prefix
   */
  private _createTextDisplay(
    level: '##' | '###',
    title: string,
    description?: string,
    emojiKey?: EmojiKeys,
  ): TextDisplayBuilder {
    const emoji = emojiKey ? `${getEmoji(emojiKey, this.client)} ` : '';
    const content = `${level} ${emoji}${title}${description ? `\n${description}` : ''}`;
    return new TextDisplayBuilder().setContent(content);
  }

  /**
   * Creates a standard container with header and optional message type
   */
  private _createMessageContainer(
    title: string,
    description: string,
    emojiKey: EmojiKeys,
    compact = false,
  ): ContainerBuilder {
    const container = new ContainerBuilder();
    const header = compact
      ? this.createCompactHeader(title, description, emojiKey)
      : this.createHeader(title, description, emojiKey);

    container.addTextDisplayComponents(header);
    return container;
  }

  /**
   * Creates a standard header for command responses
   */
  createHeader(title: string, description?: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    return this._createTextDisplay('##', title, description, emojiKey);
  }

  /**
   * Creates a standard section for command responses
   */
  createSection(title: string, content: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    return this._createTextDisplay('##', title, content, emojiKey);
  }

  /**
   * Creates a standard subsection for command responses
   */
  createSubsection(title: string, content: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    return this._createTextDisplay('###', title, content, emojiKey);
  }

  /**
   * Creates a compact header for smaller command responses (uses H3 instead of H2)
   */
  createCompactHeader(
    title: string,
    description?: string,
    emojiKey?: EmojiKeys,
  ): TextDisplayBuilder {
    return this._createTextDisplay('###', title, description, emojiKey);
  }

  /**
   * Creates a standard separator
   */
  addSeparator(
    container: ContainerBuilder,
    spacing: SeparatorSpacingSize = SeparatorSpacingSize.Large,
  ): void {
    container.addSeparatorComponents((separator) => separator.setSpacing(spacing).setDivider(true));
  }

  /**
   * Creates a standard confirmation dialog
   */
  createConfirmationDialog(
    title: string,
    description: string,
    confirmId: string,
    cancelId: string,
    emojiKey: EmojiKeys = 'alert_icon',
  ): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(this.createHeader(title, description, emojiKey));

    container.addActionRowComponents((row) => {
      const confirmButton = this._createButton({
        label: 'Confirm',
        customId: confirmId,
        style: ButtonStyle.Success,
        emoji: 'tick_icon',
      });

      const cancelButton = this._createButton({
        label: 'Cancel',
        customId: cancelId,
        style: ButtonStyle.Secondary,
        emoji: 'x_icon',
      });

      return row.addComponents(confirmButton, cancelButton);
    });

    return container;
  }

  /**
   * Creates a standard error message
   */
  createErrorMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'x_icon');
  }

  /**
   * Creates a standard success message
   */
  createSuccessMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'tick_icon');
  }

  /**
   * Creates a standard info message
   */
  createInfoMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'info_icon');
  }

  /**
   * Creates a standard warning message
   */
  createWarningMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'alert_icon');
  }

  /**
   * Creates a compact success message
   */
  createCompactSuccessMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'tick_icon', true);
  }

  /**
   * Creates a compact info message
   */
  createCompactInfoMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'info_icon', true);
  }

  /**
   * Creates a compact error message
   */
  createCompactErrorMessage(title: string, description: string): ContainerBuilder {
    return this._createMessageContainer(title, description, 'x_icon', true);
  }

  /**
   * Creates a standard button row with primary and secondary actions
   */
  createActionButtons(
    container: ContainerBuilder,
    primaryButton: ButtonConfig,
    secondaryButton?: ButtonConfig,
    tertiaryButton?: ButtonConfig,
  ): void {
    container.addActionRowComponents((row) => {
      const buttons: ButtonBuilder[] = [];

      // Primary button
      buttons.push(
        this._createButton({
          ...primaryButton,
          style: primaryButton.style || ButtonStyle.Primary,
        }),
      );

      // Secondary button
      if (secondaryButton) {
        buttons.push(
          this._createButton({
            ...secondaryButton,
            style: secondaryButton.style || ButtonStyle.Secondary,
          }),
        );
      }

      // Tertiary button (always Link style)
      if (tertiaryButton) {
        if (!tertiaryButton.url) {
          throw new Error('Tertiary button must have a URL');
        }
        buttons.push(
          this._createButton({
            ...tertiaryButton,
            style: ButtonStyle.Link,
          }),
        );
      }

      return row.addComponents(...buttons);
    });
  }

  /**
   * Gets the emoji string for a given emoji key.
   */
  getEmoji(name: EmojiKeys): string {
    return getEmoji(name, this.client);
  }
}
