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
import { showRulesScreening } from '#src/interactions/RulesScreening.js';
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
  fetchUserData,
  fetchUserLocale,
  handleError,
  hasUnreadDevAlert,
  isHumanMessage,
} from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import { EmbedBuilder, type Message } from 'discord.js';

export default class MessageCreate extends BaseEventListener<'messageCreate'> {
  readonly name = 'messageCreate';

  async execute(message: Message) {
    if (!message.inGuild() || !isHumanMessage(message)) return;

    if (message.content.startsWith('c!')) {
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
            ### Hey there! I'm InterChat, a bot that connects servers together. ${this.getEmoji('clipart')}
            - To get started, type \`/setup\` to set up InterChat with a hub.
            - If you're new here, read the rules by typing \`/rules\`.
            - Use the [hub browser](${Constants.Links.Website}/hubs) to find and join more cross-server communities.
            -# ***Need help?** Join our [support server](<${Constants.Links.SupportInvite}>).*
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
    const userData = await fetchUserData(message.author.id);
    if (!userData?.acceptedRules) {
      await showRulesScreening(message, userData);
      return;
    }

    const resolved = resolveCommand(message);
    if (!resolved.command) return;

    await executeCommand(message, resolved);
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
