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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Snowflake,
  type User,
  codeBlock,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { toTitleCase } from '#utils/Utils.js';

export const logAppeals = async (
  type: 'user' | 'server',
  hubId: string,
  appealer: User,
  opts: {
    appealsChannelId: Snowflake;
    appealsRoleId: Snowflake | null;
    appealName?: string;
    appealTargetId: Snowflake;
    appealIconUrl?: string;
    fields: {
      blacklistedFor: string;
      unblacklistReason: string;
      extras: string;
    };
  },
) => {
  const appealEmbed = new EmbedBuilder()
    .setAuthor({
      name: `${toTitleCase(type)} Blacklist Appeal`,
      iconURL: opts.appealIconUrl,
    })
    .setTitle(`Appealing for ${opts.appealName} (${opts.appealTargetId})`)
    .addFields(
      {
        name: 'Why were you/this server blacklisted?',
        value: codeBlock(opts.fields.blacklistedFor),
        inline: false,
      },
      {
        name: `Why do you think ${type === 'server' ? 'this server' : 'you'} should be unblacklisted?`,
        value: codeBlock(opts.fields.unblacklistReason),
        inline: false,
      },
      {
        name: 'Anything else you would like to add?',
        value: codeBlock(opts.fields.extras.length < 1 ? 'N/A' : opts.fields.extras),
        inline: false,
      },
    )
    .setFooter({
      text: `Appeal submitted by ${appealer.username}`,
      iconURL: appealer.displayAvatarURL(),
    })
    .setColor(Constants.Colors.invisible);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        new CustomID('appealReview:approve', [type, hubId, opts.appealTargetId]).toString(),
      )
      .setLabel('Approve')
      .setEmoji(getEmoji('tick_icon', appealer.client))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(
        new CustomID('appealReview:reject', [type, hubId, opts.appealTargetId]).toString(),
      )
      .setLabel('Reject')
      .setEmoji(getEmoji('x_icon', appealer.client))
      .setStyle(ButtonStyle.Danger),
  );

  await sendLog(appealer.client.cluster, opts.appealsChannelId, appealEmbed, {
    roleMentionIds: opts.appealsRoleId ? [opts.appealsRoleId] : undefined,
    content: `\n-# New blacklist appeal for ${opts.appealName} (${opts.appealTargetId})`,
    components: [buttonRow.toJSON()],
  });
};

export default logAppeals;
