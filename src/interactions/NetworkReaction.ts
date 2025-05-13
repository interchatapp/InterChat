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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale } from '#utils/Utils.js';
import { checkBlacklists } from '#utils/reaction/helpers.js';
import {
  addNativeReactions,
  addReaction,
  createReactionEmbed,
  createReactionSelectMenu,
  removeReaction,
  storeReactions,
  updateReactions,
} from '#utils/reaction/reactions.js';
import sortReactions from '#utils/reaction/sortReactions.js';
import { type Snowflake, time } from 'discord.js';
import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';

export default class NetworkReactionInteraction {
  @RegisterInteractionHandler('reaction_')
  async listenForReactionButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();
    if (!ctx.inGuild()) return;

    const { messageId } = this.getInteractionDetails(ctx);
    const originalMessage = await findOriginalMessage(messageId);

    const hubService = new HubService(db);
    const hub = originalMessage ? await hubService.fetchHub(originalMessage?.hubId) : null;

    if (!originalMessage || !hub?.settings.has('Reactions')) return;

    const { userBlacklisted, serverBlacklisted } = await this.checkUserPermissions(hub, ctx);
    if (userBlacklisted || serverBlacklisted) {
      await this.handleBlacklistedUser(ctx, userBlacklisted);
      return;
    }

    if (await this.isUserOnCooldown(ctx)) return;

    if (ctx.customId.suffix === 'view_all') {
      await this.handleViewAllReactions(ctx, messageId);
    }
    else {
      await this.handleReactionToggle(ctx, originalMessage);
    }
  }

  private getInteractionDetails(ctx: ComponentContext) {
    const messageId = ctx.isButton() ? ctx.interaction.message.id : ctx.customId.args[0];
    return { messageId };
  }

  private async checkUserPermissions(hub: HubManager, ctx: ComponentContext) {
    return await checkBlacklists(hub.id, ctx.guildId, ctx.user.id);
  }

  private async handleBlacklistedUser(ctx: ComponentContext, userBlacklisted: boolean) {
    const locale = await fetchUserLocale(ctx.user.id);
    const phrase = userBlacklisted ? 'errors.userBlacklisted' : 'errors.serverBlacklisted';
    await ctx.reply({
      content: t(phrase, locale, { emoji: getEmoji('no', ctx.client) }),
      flags: ['Ephemeral'],
    });
  }

  private async isUserOnCooldown(ctx: ComponentContext) {
    const cooldown = ctx.client.reactionCooldowns.get(ctx.user.id);
    if (cooldown && cooldown > Date.now()) {
      const timeString = time(Math.round(cooldown / 1000), 'R');
      await ctx.reply({
        content: `A little quick there! You can react again ${timeString}!`,
        flags: ['Ephemeral'],
      });
      return true;
    }
    ctx.client.reactionCooldowns.set(ctx.user.id, Date.now() + 3000);
    return false;
  }

  private async handleViewAllReactions(ctx: ComponentContext, messageId: string) {
    const originalMessage = await findOriginalMessage(messageId);
    if (!originalMessage?.reactions || !originalMessage.hubId) {
      await ctx.reply({
        content: 'There are no more reactions to view.',
        flags: ['Ephemeral'],
      });
      return;
    }

    const dbReactions = originalMessage.reactions as { [key: string]: Snowflake[] };

    // Sort reactions by count
    const sortedReactions = sortReactions(dbReactions);

    // Calculate total reactions
    let totalReactions = 0;
    for (const [, users] of sortedReactions) {
      totalReactions += users.length;
    }

    // Create the reaction select menu
    const selectMenu = createReactionSelectMenu(sortedReactions, messageId, ctx.user.id);

    // Create the reaction embed
    const embed = createReactionEmbed(sortedReactions, totalReactions);

    // Send the ephemeral message with the embed and select menu
    await ctx.reply({
      embeds: [embed],
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }

  private async handleReactionToggle(ctx: ComponentContext, originalMessage: MessageDB) {
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

    const reactedEmoji = ctx.isStringSelectMenu() && ctx.values && ctx.values.length > 0
      ? ctx.values[0]
      : ctx.customId.suffix;

    // For select menu, we might be adding a new emoji that doesn't exist yet
    const emojiAlreadyReacted = dbReactions[reactedEmoji] || [];

    // If it's a button ctx and the emoji doesn't exist, show an error
    if (ctx.isButton() && emojiAlreadyReacted.length === 0) {
      await ctx.reply({
        content: `${getEmoji('no', ctx.client)} This reaction doesn't exist.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Toggle the reaction
    if (emojiAlreadyReacted.includes(ctx.user.id)) {
      removeReaction(dbReactions, ctx.user.id, reactedEmoji);
    }
    else {
      addReaction(dbReactions, ctx.user.id, reactedEmoji);
    }

    // Store the updated reactions
    await storeReactions(originalMessage, dbReactions);

    // Send confirmation to the user
    await this.sendReactionConfirmation(ctx, emojiAlreadyReacted, reactedEmoji);

    // Update all broadcast messages with the new reactions
    await updateReactions(originalMessage, dbReactions);

    // Add native reactions to the original message
    await addNativeReactions(ctx.client, originalMessage, dbReactions);
  }

  private async sendReactionConfirmation(
    ctx: ComponentContext,
    emojiAlreadyReacted: Snowflake[],
    reactedEmoji: string,
  ) {
    if (ctx.isStringSelectMenu()) {
      const action = emojiAlreadyReacted.includes(ctx.user.id) ? 'unreacted' : 'reacted';
      await ctx
        .reply({
          content: `You have ${action} with ${reactedEmoji}!`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }
}
