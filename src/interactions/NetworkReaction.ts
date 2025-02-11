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

import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  type OriginalMessage,
  findOriginalMessage,
  storeMessage,
} from '#src/utils/network/messageUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID, type ParsedCustomId } from '#utils/CustomID.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale, getEmojiId } from '#utils/Utils.js';
import { addReaction, removeReaction, updateReactions } from '#utils/reaction/actions.js';
import { checkBlacklists } from '#utils/reaction/helpers.js';
import sortReactions from '#utils/reaction/sortReactions.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type Client,
  EmbedBuilder,
  type Snowflake,
  StringSelectMenuBuilder,
  time,
} from 'discord.js';

export default class NetworkReactionInteraction {
  @RegisterInteractionHandler('reaction_')
  async listenForReactionButton(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
  ): Promise<void> {
    await interaction.deferUpdate();
    if (!interaction.inCachedGuild()) return;

    const { customId, messageId } = this.getInteractionDetails(interaction);
    const originalMessage = await findOriginalMessage(messageId);

    const hubService = new HubService(db);
    const hub = originalMessage ? await hubService.fetchHub(originalMessage?.hubId) : null;

    if (!originalMessage || !hub?.settings.has('Reactions')) return;

    const { userBlacklisted, serverBlacklisted } = await this.checkUserPermissions(
      hub,
      interaction,
    );
    if (userBlacklisted || serverBlacklisted) {
      await this.handleBlacklistedUser(interaction, userBlacklisted);
      return;
    }

    if (await this.isUserOnCooldown(interaction)) return;

    if (customId.suffix === 'view_all') {
      await this.handleViewAllReactions(interaction, messageId, hub);
    }
    else {
      await this.handleReactionToggle(interaction, originalMessage, customId);
    }
  }

  private getInteractionDetails(interaction: ButtonInteraction | AnySelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const messageId = interaction.isButton() ? interaction.message.id : customId.args[0];
    return { customId, messageId };
  }

  private async checkUserPermissions(
    hub: HubManager,
    interaction: ButtonInteraction | AnySelectMenuInteraction,
  ) {
    return await checkBlacklists(hub.id, interaction.guildId, interaction.user.id);
  }

  private async handleBlacklistedUser(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    userBlacklisted: boolean,
  ) {
    const locale = await fetchUserLocale(interaction.user.id);
    const phrase = userBlacklisted ? 'errors.userBlacklisted' : 'errors.serverBlacklisted';
    await interaction.followUp({
      content: t(phrase, locale, { emoji: getEmoji('no', interaction.client) }),
      flags: ['Ephemeral'],
    });
  }

  private async isUserOnCooldown(interaction: ButtonInteraction | AnySelectMenuInteraction) {
    const cooldown = interaction.client.reactionCooldowns.get(interaction.user.id);
    if (cooldown && cooldown > Date.now()) {
      const timeString = time(Math.round(cooldown / 1000), 'R');
      await interaction.followUp({
        content: `A little quick there! You can react again ${timeString}!`,
        flags: ['Ephemeral'],
      });
      return true;
    }
    interaction.client.reactionCooldowns.set(interaction.user.id, Date.now() + 3000);
    return false;
  }

  private async handleViewAllReactions(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    messageId: string,
    hub: HubManager,
  ) {
    const originalMessage = await findOriginalMessage(messageId);
    if (!originalMessage?.reactions || !originalMessage.hubId) {
      await interaction.followUp({
        content: 'There are no more reactions to view.',
        flags: ['Ephemeral'],
      });
      return;
    }

    const dbReactions = originalMessage.reactions as {
      [key: string]: Snowflake[];
    };
    const { reactionMenu, reactionString, totalReactions } = this.buildReactionMenu(
      dbReactions,
      interaction,
      hub,
    );

    const embed = this.buildReactionEmbed(reactionString, totalReactions, interaction.client);

    await interaction.followUp({
      embeds: [embed],
      components: [reactionMenu],
      flags: ['Ephemeral'],
    });
  }

  private buildReactionMenu(
    dbReactions: { [key: string]: Snowflake[] },
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    hub: HubManager,
  ) {
    const sortedReactions = sortReactions(dbReactions);
    let totalReactions = 0;
    let reactionString = '';
    const reactionMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID().setIdentifier('reaction_').setArgs(interaction.message.id).toString(),
        )
        .setPlaceholder('Add a reaction'),
    );

    if (!hub.settings.has('Reactions')) reactionMenu.components[0].setDisabled(true);

    sortedReactions.forEach((r, index) => {
      if (r[1].length === 0 || index >= 10) return;
      reactionMenu.components[0].addOptions({
        label: 'React/Unreact',
        value: r[0],
        emoji: getEmojiId(r[0]),
      });
      totalReactions++;
      reactionString += `- ${r[0]}: ${r[1].length}\n`;
    });

    return { reactionMenu, reactionString, totalReactions };
  }

  private buildReactionEmbed(reactionString: string, totalReactions: number, client: Client) {
    return new EmbedBuilder()
      .setDescription(
        stripIndents`
          ## ${getEmoji('clipart', client)} Reactions

          ${reactionString || 'No reactions yet!'}

          **Total Reactions:**
          __${totalReactions}__
      `,
      )
      .setColor(Constants.Colors.invisible);
  }

  private async handleReactionToggle(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    originalMessage: OriginalMessage,
    customId: ParsedCustomId,
  ) {
    const dbReactions = (originalMessage.reactions?.valueOf() ?? {}) as {
      [key: string]: Snowflake[];
    };

    const reactedEmoji = interaction.isStringSelectMenu() ? interaction.values[0] : customId.suffix;
    const emojiAlreadyReacted = dbReactions[reactedEmoji];

    if (!emojiAlreadyReacted) {
      await interaction.followUp({
        content: `${getEmoji('no', interaction.client)} This reaction doesn't exist.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (emojiAlreadyReacted.includes(interaction.user.id)) {
      removeReaction(dbReactions, interaction.user.id, reactedEmoji);
    }
    else {
      addReaction(dbReactions, interaction.user.id, reactedEmoji);
    }

    await this.updateReactionsInDb(originalMessage, dbReactions);
    await this.sendReactionConfirmation(interaction, emojiAlreadyReacted, reactedEmoji);

    await updateReactions(originalMessage, dbReactions);
  }

  private async updateReactionsInDb(
    originalMessage: OriginalMessage,
    reactions: { [key: string]: Snowflake[] },
  ) {
    await storeMessage(originalMessage.messageId, {
      ...originalMessage,
      reactions,
    });
  }

  private async sendReactionConfirmation(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    emojiAlreadyReacted: Snowflake[],
    reactedEmoji: string,
  ) {
    if (interaction.isStringSelectMenu()) {
      const action = emojiAlreadyReacted.includes(interaction.user.id) ? 'reacted' : 'unreacted';
      await interaction
        .followUp({
          content: `You have ${action} with ${reactedEmoji}!`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }
}
