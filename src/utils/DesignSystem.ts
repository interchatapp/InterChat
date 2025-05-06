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
   * Creates a standard header for command responses
   */
  createHeader(title: string, description?: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    // Use a safe default emoji if the requested one doesn't exist
    let emoji = '';
    if (emojiKey) emoji = `${getEmoji(emojiKey, this.client)} `;

    const content = `## ${emoji}${title}${description ? `\n${description}` : ''}`;
    return new TextDisplayBuilder().setContent(content);
  }

  /**
   * Creates a standard section for command responses
   */
  createSection(title: string, content: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    // Use a safe default emoji if the requested one doesn't exist
    let emoji = '';
    if (emojiKey) {
      emoji = `${getEmoji(emojiKey, this.client)} `;
    }

    const text = `## ${emoji}${title}\n${content}`;
    return new TextDisplayBuilder().setContent(text);
  }

  /**
   * Creates a standard subsection for command responses
   */
  createSubsection(title: string, content: string, emojiKey?: EmojiKeys): TextDisplayBuilder {
    // Use a safe default emoji if the requested one doesn't exist
    let emoji = '';
    if (emojiKey) {
      emoji = `${getEmoji(emojiKey, this.client)} `;
    }

    const text = `### ${emoji}${title}\n${content}`;
    return new TextDisplayBuilder().setContent(text);
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

    // Add header
    container.addTextDisplayComponents(this.createHeader(title, description, emojiKey));

    // Add confirmation buttons
    container.addActionRowComponents((row) => {
      const confirmButton = new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success);

      const cancelButton = new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

      confirmButton.setEmoji(getEmoji('tick_icon', this.client));
      cancelButton.setEmoji(getEmoji('x_icon', this.client));

      return row.addComponents(confirmButton, cancelButton);
    });

    return container;
  }

  /**
   * Creates a standard error message
   */
  createErrorMessage(title: string, description: string): ContainerBuilder {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(this.createHeader(title, description, 'x_icon'));

    return container;
  }

  /**
   * Creates a standard success message
   */
  createSuccessMessage(title: string, description: string): ContainerBuilder {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(this.createHeader(title, description, 'tick_icon'));

    return container;
  }

  /**
   * Creates a standard info message
   */
  createInfoMessage(title: string, description: string): ContainerBuilder {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(this.createHeader(title, description, 'info_icon'));

    return container;
  }

  /**
   * Creates a standard warning message
   */
  createWarningMessage(title: string, description: string): ContainerBuilder {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(this.createHeader(title, description, 'alert_icon'));

    return container;
  }

  /**
   * Creates a standard button row with primary and secondary actions
   */
  createActionButtons(
    container: ContainerBuilder,
    primaryButton: {
      label: string;
      customId?: string;
      url?: string;
      emoji?: EmojiKeys | (string & {});
    },
    secondaryButton?: {
      label: string;
      customId?: string;
      url?: string;
      emoji?: EmojiKeys | (string & {});
    },
    tertiaryButton?: { label: string; url: string; emoji?: EmojiKeys | (string & {}) },
  ): void {
    container.addActionRowComponents((row) => {
      const buttons: ButtonBuilder[] = [new ButtonBuilder().setLabel(primaryButton.label)];
      if (primaryButton.url) {
        buttons[0].setStyle(ButtonStyle.Link).setURL(primaryButton.url);
      }
      else if (primaryButton.customId) {
        buttons[0].setCustomId(primaryButton.customId).setStyle(ButtonStyle.Primary);
      }
      else {
        throw new Error('Either customId or url must be provided for primary button');
      }

      // Try to set emoji safely
      if (primaryButton.emoji) {
        try {
          if (typeof primaryButton.emoji === 'string') {
            // If it's a string, check if it's an EmojiKey or a Unicode emoji
            if (primaryButton.emoji.length <= 2 || primaryButton.emoji.startsWith('�')) {
              // It's likely a Unicode emoji
              buttons[0].setEmoji({ name: primaryButton.emoji });
            }
            else {
              // It's likely an EmojiKey
              buttons[0].setEmoji(getEmoji(primaryButton.emoji as EmojiKeys, this.client));
            }
          }
          else if (typeof primaryButton.emoji === 'object' && 'name' in primaryButton.emoji) {
            // It's already a Discord.js emoji object
            buttons[0].setEmoji(primaryButton.emoji);
          }
        }
        catch {
          // Fallback to no emoji if not found
        }
      }

      if (secondaryButton) {
        const secBtn = new ButtonBuilder()
          .setLabel(secondaryButton.label)
          .setStyle(ButtonStyle.Secondary);

        if (secondaryButton.url) {
          secBtn.setStyle(ButtonStyle.Link).setURL(secondaryButton.url);
        }
        else if (secondaryButton.customId) {
          secBtn.setCustomId(secondaryButton.customId).setStyle(ButtonStyle.Secondary);
        }
        else {
          throw new Error('Either customId or url must be provided for secondary button');
        }

        // Try to set emoji safely
        if (secondaryButton.emoji) {
          try {
            if (typeof secondaryButton.emoji === 'string') {
              // If it's a string, check if it's an EmojiKey or a Unicode emoji
              if (secondaryButton.emoji.length <= 2 || secondaryButton.emoji.startsWith('�')) {
                // It's likely a Unicode emoji
                secBtn.setEmoji({ name: secondaryButton.emoji });
              }
              else {
                // It's likely an EmojiKey
                secBtn.setEmoji(getEmoji(secondaryButton.emoji as EmojiKeys, this.client));
              }
            }
            else if (
              typeof secondaryButton.emoji === 'object' &&
              'name' in secondaryButton.emoji
            ) {
              // It's already a Discord.js emoji object
              secBtn.setEmoji(secondaryButton.emoji);
            }
          }
          catch {
            // Fallback to no emoji if not found
          }
        }

        buttons.push(secBtn);
      }

      if (tertiaryButton) {
        const tertBtn = new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(tertiaryButton.label)
          .setURL(tertiaryButton.url);

        // Try to set emoji safely
        if (tertiaryButton.emoji) {
          if (typeof tertiaryButton.emoji === 'string') {
            // If it's a string, check if it's an EmojiKey or a Unicode emoji
            if (tertiaryButton.emoji.length <= 2 || tertiaryButton.emoji.startsWith('�')) {
              // It's likely a Unicode emoji
              tertBtn.setEmoji({ name: tertiaryButton.emoji });
            }
            else {
              // It's likely an EmojiKey
              tertBtn.setEmoji(getEmoji(tertiaryButton.emoji as EmojiKeys, this.client));
            }
          }
          else if (typeof tertiaryButton.emoji === 'object' && 'name' in tertiaryButton.emoji) {
            // It's already a Discord.js emoji object
            tertBtn.setEmoji(tertiaryButton.emoji);
          }
        }

        buttons.push(tertBtn);
      }

      return row.addComponents(...buttons);
    });
  }
}
