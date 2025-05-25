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

import type { BlockWordAction } from '#src/generated/prisma/client/client.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';
import { ACTION_LABELS } from '#utils/moderation/antiSwear.js';
import { stripIndents } from 'common-tags';
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type Message,
} from 'discord.js';

/**
 * Rule interface for the antiswear alert system
 * Contains only the properties needed for alert logging
 */
export interface AntiSwearRule {
  id: string;
  hubId: string;
  name: string;
  actions: BlockWordAction[];
}

const boldANSIText = (text: string) => `\u001b[1;2m${text}\u001b[0m`;

/**
 * Log an alert when a prohibited word is detected
 * Enhanced with Components v2 UI and Take Action buttons
 */
export const logAntiSwearAlert = async (
  message: Message<true>,
  rule: AntiSwearRule,
  matches: string[],
) => {
  const logManager = await HubLogManager.create(rule.hubId);
  if (!logManager.config.networkAlertsChannelId) return;

  let content = message.content;
  matches.forEach((match) => {
    content = content.replaceAll(match, boldANSIText(match));
  });

  // Create Components v2 container
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          ## ${getEmoji('exclamation', message.client)} Prohibited Word Alert

          **Rule Triggered:** ${rule.name}
          **Author:** ${message.author.tag} (\`${message.author.id}\`)
          **Server:** ${message.guild.name} (\`${message.guild.id}\`)
          **Actions Taken:** ${rule.actions.map((a) => ACTION_LABELS[a]).join(', ')}
        `,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          ### ${getEmoji('info', message.client)} Detected Message Content
          \`\`\`ansi
          ${content}
          \`\`\`
          **Message ID:** \`${message.id}\`
          **Channel:** <#${message.channel.id}>
        `,
      ),
    );

  // Send the log with Components v2
  await sendLog(message.client.cluster, logManager.config.networkAlertsChannelId, null, {
    roleMentionIds: logManager.config.networkAlertsRoleId
      ? [logManager.config.networkAlertsRoleId]
      : undefined,
    components: [container],
    flags: [MessageFlags.IsComponentsV2],
  });
};
