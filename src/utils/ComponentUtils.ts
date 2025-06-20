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

import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { t, type supportedLocaleCodes } from '#utils/Locale.js';
import {
  type ActionRow,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ComponentType,
  type MessageActionRowComponent,
  type Snowflake,
  messageLink,
} from 'discord.js';

export const greyOutButton = (row: ActionRowBuilder<ButtonBuilder>, disableElement: number) => {
  row.components.forEach((c) => c.setDisabled(false));
  row.components[disableElement].setDisabled(true);
};
export const greyOutButtons = (rows: ActionRowBuilder<ButtonBuilder>[]) => {
  for (const row of rows) {
    row.components.forEach((c) => c.setDisabled(true));
  }
};

export const generateJumpButton = (
  client: Client,
  referredAuthorUsername: string,
  opts: { messageId: Snowflake; channelId: Snowflake; serverId: Snowflake },
) =>
  // create a jump to reply button
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setEmoji(getEmoji('reply', client))
      .setURL(messageLink(opts.channelId, opts.messageId, opts.serverId))
      .setLabel(
        referredAuthorUsername.length >= 80
          ? `@${referredAuthorUsername.slice(0, 76)}...`
          : `@${referredAuthorUsername}`,
      ),
  );

export const disableAllComponents = (
  components: ActionRow<MessageActionRowComponent>[],
  disableLinks = false,
) =>
  components.map((row) => {
    const jsonRow = row.toJSON();
    for (const component of jsonRow.components) {
      if (
        !disableLinks &&
        component.type === ComponentType.Button &&
        component.style === ButtonStyle.Link // leave link buttons enabled
      ) {
        component.disabled = false;
      }
      else {
        component.disabled = true;
      }
    }

    return jsonRow;
  });

export const donateButton = new ButtonBuilder()
  .setLabel('Donate')
  .setURL(`${Constants.Links.Website}/donate`)
  .setEmoji('💗')
  .setStyle(ButtonStyle.Link);

/**
 * Creates a call rating button row with like/dislike/report buttons
 * @param callId - The call ID to associate with the buttons
 * @param locale - The locale for button labels (optional, defaults to English hardcoded labels)
 * @param options - Additional options for button configuration
 * @returns ActionRowBuilder with rating buttons
 */
export const createCallRatingRow = (
  callId: string,
  locale?: supportedLocaleCodes,
  options: { separateReportRow?: boolean } = {},
) => {
  const { separateReportRow = false } = options;

  // Create like and dislike buttons
  const likeButton = new ButtonBuilder()
    .setCustomId(new CustomID('rate_call:like', [callId]).toString())
    .setLabel(locale ? t('calls.buttons.ratePositive', locale) : '👍 Like')
    .setStyle(ButtonStyle.Success);

  const dislikeButton = new ButtonBuilder()
    .setCustomId(new CustomID('rate_call:dislike', [callId]).toString())
    .setLabel(locale ? t('calls.buttons.rateNegative', locale) : '👎 Dislike')
    .setStyle(ButtonStyle.Danger);

  // Create report button
  const reportButton = new ButtonBuilder()
    .setCustomId(new CustomID('report_call', [callId]).toString())
    .setLabel(locale ? t('calls.buttons.reportCall', locale) : '🚩 Report')
    .setStyle(ButtonStyle.Secondary);

  // Add emoji for localized report button (matches existing pattern)
  if (locale) {
    reportButton.setEmoji('🚩');
  }

  if (separateReportRow) {
    // Return rating row only (for CallService pattern)
    return new ActionRowBuilder<ButtonBuilder>().addComponents(likeButton, dislikeButton);
  }

  // Return combined row (for call.ts and hangup.ts pattern)
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    likeButton,
    dislikeButton,
    reportButton,
  );
};

/**
 * Creates a separate report button row (used with separateReportRow option)
 * @param callId - The call ID to associate with the button
 * @param locale - The locale for button label (optional, defaults to English hardcoded label)
 * @returns ActionRowBuilder with report button
 */
export const createCallReportRow = (callId: string, locale?: supportedLocaleCodes) => {
  const reportButton = new ButtonBuilder()
    .setCustomId(new CustomID('report_call', [callId]).toString())
    .setLabel(locale ? t('calls.buttons.reportCall', locale) : '🚩 Report')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);
};
