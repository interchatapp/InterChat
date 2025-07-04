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

import BaseEventListener from '#src/core/BaseEventListener.js';
import { openInboxButton } from '#src/interactions/ShowInboxButton.js';
import HubManager from '#src/managers/HubManager.js';
import InfractionManager from '#src/managers/InfractionManager.js';
import { MessageProcessor } from '#src/services/MessageProcessor.js';
import { executeCommand, resolveCommand } from '#src/utils/CommandUtils.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import { t } from '#src/utils/Locale.js';
import getRedis from '#src/utils/Redis.js';
import {
  createUnreadDevAlertEmbed,
  ensureUserExists,
  fetchUserData,
  fetchUserLocale,
  handleError,
  hasUnreadDevAlert,
  isHumanMessage,
  updateUserInfoIfChanged,
} from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import { EmbedBuilder, type Message } from 'discord.js';

export default class MessageCreate extends BaseEventListener<'messageCreate'> {
  readonly name = 'messageCreate';

  async execute(message: Message) {
    if (!message.inGuild() || !isHumanMessage(message)) return;

    // FIXME: this is temp, remove on 01/07/2025
    if (message.content.includes('c!')) {
      await message.reply(
        'The `c!` prefix has been changed to `.`. Type `.help` to see all available commands.',
      );
      return;
    }

    if (message.content.startsWith(message.client.prefix)) {
      await this.handlePrefixCommand(message);
      return;
    }
    if (
      message.content === `<@${message.client.user.id}>` ||
      message.content === `<@!${message.client.user.id}>`
    ) {
      await message.channel
        .send(
          stripIndents`
            ### Hello there! 👋 I'm InterChat, and I'm so excited to meet you! ${this.getEmoji('clipart')}

            I'm here to help you connect with amazing communities from all around Discord! Think of me as your friendly bridge to thousands of servers and millions of new friends waiting to chat with you.

            **🚀 Ready to start your adventure?**
            - **New here?** Type \`/setup\` and I'll guide you through everything step by step!
            - **Want to explore?** Check out the [Discovery Page](${Constants.Links.Website}/hubs) to find and join active hubs
            - **Need the basics?** Type \`/tutorial\` for interactive guides
            - **Feeling adventurous?** Try \`/call\` for instant connections with other servers!

            **💝 Need a helping hand?** Don't worry - we've all been beginners! Join our welcoming [support community](<${Constants.Links.SupportInvite}>) where real people are excited to help you get started. No question is too small!

            *Ready to make some new friends? Let's do this!* ✨
      `,
        )
        .catch(() => null);
    }

    const processor = new MessageProcessor(message.client);
    Promise.all([
      this.handleChatMessage(message, processor),
      processor.processCallMessage(message),
    ]).catch(handleError);
  }

  private async handlePrefixCommand(message: Message): Promise<void> {
    // Ensure user exists in database when using commands
    await ensureUserExists(message.author.id, message.author.username, message.author.avatarURL());

    const resolved = resolveCommand(message);
    // Execute command even if command is null but we have subcommand errors
    if (!resolved.command && !resolved.subcommandError) return;

    if (resolved.command?.contexts?.guildOnly && !message.inGuild()) {
      await message.reply('This command can only be used in a server.');
      return;
    }

    await executeCommand(message, resolved);

    // Update user info if changed (after successful command execution)
    updateUserInfoIfChanged(
      message.author.id,
      message.author.username,
      message.author.avatarURL(),
    ).catch(() => null); // Don't let this fail the whole process

    await this.showDevAlertsIfAny(message);
  }

  private async handleChatMessage(message: Message<true>, processor: MessageProcessor) {
    const result = await processor.processHubMessage(message);

    if (result.handled === true) {
      await this.showDevAlertsIfAny(message);
      await this.notifyHubWarnsIfAny(message, result.hub);
    }
  }

  /**
   * Check and notify about warnings after successful message broadcast
   */
  private async notifyHubWarnsIfAny(message: Message<true>, hub: HubManager) {
    const locale = await fetchUserLocale(message.author.id);
    const infractionManager = new InfractionManager('user', message.author.id);
    const warnings = await infractionManager.getUnnotifiedInfractions('WARNING', hub.id);

    if (warnings.length === 0) return;

    const dmEmbed = new EmbedBuilder()
      .setTitle(
        t('warn.dm.title', locale, {
          emoji: this.getEmoji('exclamation'),
        }),
      )
      .setDescription(t('warn.dm.description', locale, { hubName: hub.data.name }))
      .setColor('Yellow')
      .addFields({
        name: 'Reason',
        value: warnings[0].reason || 'No reason provided',
        inline: true,
      });
    await message.author.send({ embeds: [dmEmbed] }).catch(() => null);

    // Mark warnings as notified
    await infractionManager.markInfractionsAsNotified(warnings.map((w) => w.id));
  }

  private async showDevAlertsIfAny(message: Message) {
    const redis = getRedis();
    const key = `${RedisKeys.DevAnnouncement}:${message.author.id}:lastAskedDate`;
    const lastAsked = await redis.get(key);

    // check if the user has been asked to check inbox in the last 10 minutes
    if (lastAsked && Date.now() - Number(lastAsked) < 600_000) return;

    const userData = await fetchUserData(message.author.id);
    if (!userData) return;

    const shouldShow = await hasUnreadDevAlert(userData);
    if (!shouldShow) return;

    await message.author
      .send({
        embeds: [createUnreadDevAlertEmbed(this.getEmoji('info_icon'))],
        components: [openInboxButton],
      })
      .catch(() => null);

    await redis.set(key, Date.now().toString(), 'EX', 600);
  }
}
