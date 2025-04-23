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

import type { BlockWord } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';
import { EmbedBuilder, type Message } from 'discord.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';
import { ACTION_LABELS, createRegexFromWords } from '#utils/moderation/antiSwear.js';

const boldANSIText = (text: string) => `\u001b[1;2m${text}\u001b[0m`;

export const logBlockwordAlert = async (
  message: Message<true>,
  rule: BlockWord,
  matches: string[],
) => {
  const logManager = await HubLogManager.create(rule.hubId);
  if (!logManager.config.networkAlertsChannelId) return;

  const content = message.content.replace(createRegexFromWords(matches), boldANSIText);
  const embed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle(`${getEmoji('exclamation', message.client)} Blocked Word Alert`)
    .setDescription(
      stripIndents`
        A message containing blocked words was detected:

        **Rule Triggered:** ${rule.name}
        **Author:** ${message.author.tag} (${message.author.id})
        **Server:** ${message.guild.name} (${message.guild.id})

        ### Message Content:
          \`\`\`ansi
            ${content}
          \`\`\`
      -# Actions Taken: **${rule.actions.map((a) => ACTION_LABELS[a]).join(', ')}**
    `,
    )
    .setTimestamp();

  await sendLog(message.client.cluster, logManager.config.networkAlertsChannelId, embed, {
    roleMentionIds: logManager.config.networkAlertsRoleId
      ? [logManager.config.networkAlertsRoleId]
      : undefined,
  });
};
