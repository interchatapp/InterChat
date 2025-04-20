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
import { type OriginalMessage, findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { CustomID, type ParsedCustomId } from '#utils/CustomID.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale } from '#utils/Utils.js';
import {
  addReaction,
  removeReaction,
  updateReactions,
  storeReactions,
  createReactionEmbed,
  createReactionSelectMenu,
  addNativeReactions,
} from '#utils/reaction/reactions.js';
import { checkBlacklists } from '#utils/reaction/helpers.js';
import sortReactions from '#utils/reaction/sortReactions.js';
import {
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type Snowflake,
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
      await this.handleViewAllReactions(interaction, messageId);
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
  ) {
    const originalMessage = await findOriginalMessage(messageId);
    if (!originalMessage?.reactions || !originalMessage.hubId) {
      await interaction.followUp({
        content: 'There are no more reactions to view.',
        flags: ['Ephemeral'],
      });
      return;
    }

    const dbReactions: { [key: string]: Snowflake[] } = JSON.parse(originalMessage.reactions);

    // Sort reactions by count
    const sortedReactions = sortReactions(dbReactions);

    // Calculate total reactions
    let totalReactions = 0;
    for (const [, users] of sortedReactions) {
      totalReactions += users.length;
    }

    // Create the reaction select menu
    const selectMenu = createReactionSelectMenu(sortedReactions, messageId, interaction.user.id);

    // Create the reaction embed
    const embed = createReactionEmbed(sortedReactions, totalReactions);

    // Send the ephemeral message with the embed and select menu
    await interaction.followUp({
      embeds: [embed],
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }

  private async handleReactionToggle(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    originalMessage: OriginalMessage,
    customId: ParsedCustomId,
  ) {
    // Parse reactions from JSON string or default to empty object
    let dbReactions: { [key: string]: Snowflake[] } = {};

    try {
      if (originalMessage.reactions) {
        dbReactions = JSON.parse(originalMessage.reactions as string);
      }
    }
    catch {
      // Fallback to empty object if parsing fails
      dbReactions = {};
    }

    const reactedEmoji = interaction.isStringSelectMenu() ? interaction.values[0] : customId.suffix;

    // For select menu, we might be adding a new emoji that doesn't exist yet
    const emojiAlreadyReacted = dbReactions[reactedEmoji] || [];

    // If it's a button interaction and the emoji doesn't exist, show an error
    if (interaction.isButton() && emojiAlreadyReacted.length === 0) {
      await interaction.followUp({
        content: `${getEmoji('no', interaction.client)} This reaction doesn't exist.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Toggle the reaction
    if (emojiAlreadyReacted.includes(interaction.user.id)) {
      removeReaction(dbReactions, interaction.user.id, reactedEmoji);
    }
    else {
      addReaction(dbReactions, interaction.user.id, reactedEmoji);
    }

    // Store the updated reactions
    await storeReactions(originalMessage, dbReactions);

    // Send confirmation to the user
    await this.sendReactionConfirmation(interaction, emojiAlreadyReacted, reactedEmoji);

    // Update all broadcast messages with the new reactions
    await updateReactions(originalMessage, dbReactions);

    // Add native reactions to the original message
    await addNativeReactions(interaction.client, originalMessage, dbReactions);
  }

  private async sendReactionConfirmation(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
    emojiAlreadyReacted: Snowflake[],
    reactedEmoji: string,
  ) {
    if (interaction.isStringSelectMenu()) {
      const action = emojiAlreadyReacted.includes(interaction.user.id) ? 'unreacted' : 'reacted';
      await interaction
        .followUp({
          content: `You have ${action} with ${reactedEmoji}!`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }
}
