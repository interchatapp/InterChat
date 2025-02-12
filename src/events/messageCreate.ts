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

import { stripIndents } from 'common-tags';
import type { Client, Message } from 'discord.js';
import BaseEventListener from '#src/core/BaseEventListener.js';
import { showRulesScreening } from '#src/interactions/RulesScreening.js';
import { MessageProcessor } from '#src/services/MessageProcessor.js';
import Constants from '#src/utils/Constants.js';
import { fetchUserData, handleError, isHumanMessage } from '#utils/Utils.js';
import { executeCommand, resolveCommand } from '#src/utils/CommandUtils.js';

export default class MessageCreate extends BaseEventListener<'messageCreate'> {
  readonly name = 'messageCreate';
  private readonly messageProcessor: MessageProcessor;

  constructor(client: Client<true> | null) {
    super(client ?? null);
    this.messageProcessor = new MessageProcessor();
  }

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

    await this.handleChatMessage(message).catch(handleError);
  }

  private async handlePrefixCommand(message: Message): Promise<void> {
    const userData = await fetchUserData(message.author.id);
    if (!userData?.acceptedRules) {
      await showRulesScreening(message, userData);
      return;
    }

    const { command, prefixArgs } = resolveCommand(message);
    if (!command) return;

    await executeCommand(message, command, prefixArgs);
  }

  private async handleChatMessage(message: Message<true>) {
    await this.messageProcessor.processHubMessage(message);
  }
}
