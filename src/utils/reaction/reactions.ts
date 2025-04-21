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
  type OriginalMessage,
  getBroadcasts,
  storeMessage,
} from '#src/utils/network/messageUtils.js';
import type { ReactionArray } from '#types/Utils.d.ts';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { parseEmoji } from '#utils/Utils.js';
import {
  type APIActionRowComponent,
  type APIMessageActionRowComponent,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  calculateShardId,
} from 'discord.js';

import sortReactions from './sortReactions.js';

// Maximum number of emoji buttons to show directly on the message
const MAX_VISIBLE_REACTIONS = 4;

/**
 * Add a reaction from a user to a message
 * @param reactionArr The reaction array to modify
 * @param userId The ID of the user adding the reaction
 * @param emoji The emoji to add
 */
export const addReaction = (
  reactionArr: ReactionArray,
  userId: string,
  emoji: string,
): void => {
  reactionArr[emoji] = reactionArr[emoji] || [];
  if (!reactionArr[emoji].includes(userId)) {
    reactionArr[emoji].push(userId);
  }
};

/**
 * Remove a reaction from a user on a message
 * @param reactionArr The reaction array to modify
 * @param userId The ID of the user removing the reaction
 * @param emoji The emoji to remove
 * @returns The modified reaction array
 */
export const removeReaction = (
  reactionArr: ReactionArray,
  userId: string,
  emoji: string,
): ReactionArray => {
  if (reactionArr[emoji]) {
    reactionArr[emoji] = reactionArr[emoji].filter((id) => id !== userId);
    if (reactionArr[emoji].length === 0) {
      delete reactionArr[emoji];
    }
  }
  return reactionArr;
};

/**
 * Create reaction buttons for a message based on the sorted reactions
 * @param sortedReactions Array of sorted reactions
 * @returns ActionRow with reaction buttons or null if no reactions
 */
export const createReactionButtons = (
  sortedReactions: [string, string[]][],
): ActionRowBuilder<ButtonBuilder> | null => {
  if (sortedReactions.length === 0) return null;

  const reactionRow = new ActionRowBuilder<ButtonBuilder>();

  // Add up to MAX_VISIBLE_REACTIONS buttons for the most used emojis
  const visibleReactions = sortedReactions.slice(0, MAX_VISIBLE_REACTIONS);

  for (const [reaction, users] of visibleReactions) {
    const reactionCount = users.length;
    const parsedEmoji = parseEmoji(reaction);

    // Create button with appropriate emoji
    const button = new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('reaction_', reaction).toString(),
      )
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`${reactionCount}`);

    // If it's a custom Discord emoji
    if (parsedEmoji) {
      button.setEmoji(parsedEmoji.id);
    }
    // If it's a standard Unicode emoji
    else {
      button.setEmoji(reaction);
    }

    reactionRow.addComponents(button);
  }

  // If there are more reactions than we can show, add a +X button
  const additionalReactionsCount =
		sortedReactions.length - visibleReactions.length;
  if (additionalReactionsCount > 0) {
    reactionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          new CustomID().setIdentifier('reaction_', 'view_all').toString(),
        )
        .setStyle(ButtonStyle.Secondary)
        .setLabel(`+${additionalReactionsCount}`),
    );
  }

  return reactionRow.components.length > 0 ? reactionRow : null;
};

/**
 * Create a select menu for adding/removing reactions
 * @param sortedReactions Array of sorted reactions
 * @param messageId The ID of the message
 * @param userId The ID of the user viewing the menu
 * @returns ActionRow with select menu
 */
export const createReactionSelectMenu = (
  sortedReactions: [string, string[]][],
  messageId: string,
  userId: string,
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const selectMenu =
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		  new StringSelectMenuBuilder()
		    .setCustomId(
		      new CustomID()
		        .setIdentifier('reaction_')
		        .setArgs(messageId)
		        .toString(),
		    )
		    .setPlaceholder('Add or remove a reaction')
		    .setMinValues(1)
		    .setMaxValues(1),
		);

  // Common emojis to offer as options if there aren't many reactions yet
  const commonEmojis = [
    '👍',
    '👎',
    '❤️',
    '😂',
    '😮',
    '😢',
    '😡',
    '🎉',
    '🙏',
    '🔥',
  ];

  // Add existing reactions to the menu
  const existingEmojis = new Set<string>();

  // Find the user's current reaction (if any)
  let userCurrentReaction: string | null = null;
  for (const [emoji, users] of sortedReactions) {
    if (users.includes(userId)) {
      userCurrentReaction = emoji;
      break;
    }
  }

  for (const [emoji, users] of sortedReactions) {
    existingEmojis.add(emoji);

    const option = new StringSelectMenuOptionBuilder()
      .setValue(emoji)
      .setLabel(`React / Unreact with this (${users.length}) `);

    // Only set default for the user's current reaction
    if (emoji === userCurrentReaction) {
      option.setDefault(true);
    }

    // Handle emoji display in the select menu
    const parsedEmoji = parseEmoji(emoji);
    if (parsedEmoji) {
      option.setEmoji(parsedEmoji.id);
    }
    else {
      option.setEmoji(emoji);
    }

    selectMenu.components[0].addOptions(option);
  }

  // Add common emojis that aren't already in the reactions
  for (const emoji of commonEmojis) {
    if (
      !existingEmojis.has(emoji) &&
			selectMenu.components[0].options.length < 25
    ) {
      const option = new StringSelectMenuOptionBuilder()
        .setValue(emoji)
        .setEmoji(emoji)
        .setLabel('Add / remove reaction');

      selectMenu.components[0].addOptions(option);
    }
  }

  return selectMenu;
};

/**
 * Create an embed showing all reactions on a message
 * @param sortedReactions Array of sorted reactions
 * @param totalReactions Total number of reactions
 * @returns Embed with reaction information
 */
export const createReactionEmbed = (
  sortedReactions: [string, string[]][],
  totalReactions: number,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle(`All Reactions (${totalReactions})`)
    .setFooter({
      text: 'Use the select menu below to add or remove a reaction.',
    })
    .setColor('#5865F2');

  if (sortedReactions.length === 0) {
    embed.setDescription('No reactions yet. Be the first to react!');
    return embed;
  }

  let description = '';
  for (const [emoji, users] of sortedReactions) {
    description += `${emoji} **${users.length}**\n`;
  }

  embed.setDescription(description);
  return embed;
};

/**
 * Update the components of a message to include reaction buttons
 * @param message The message to update
 * @param reactionRow The action row with reaction buttons
 * @returns The updated components
 */
export const updateMessageComponents = (
  components: APIActionRowComponent<APIMessageActionRowComponent>[],
  reactionRow: ActionRowBuilder<ButtonBuilder> | null,
): APIActionRowComponent<APIMessageActionRowComponent>[] => {
  if (!reactionRow) return components;

  // Filter out rows that contain reaction buttons
  const nonReactionRows = components.filter((row) => {
    // Check if any component in this row is a reaction button
    const hasReactionButtons = (row.components || []).some((component) => {
      // Only buttons can be reaction buttons
      if (component.type !== ComponentType.Button) return false;

      // Only buttons with custom_id can be reaction buttons
      // @ts-expect-error - custom_id exists on APIButtonComponentWithCustomId
      const customId = component.custom_id;
      if (!customId) return false;

      // Check if it's a reaction button by its custom_id prefix
      const parsedCustomId = CustomID.parseCustomId(customId);
      return parsedCustomId.prefix === 'reaction_';
    });

    // Keep rows that don't have any reaction buttons
    return !hasReactionButtons;
  });

  // Add the new reaction row at the end
  return [...nonReactionRows, reactionRow.toJSON()];
};

/**
 * Update all broadcast messages with the new reactions
 * @param originalMessage The original message
 * @param reactions The reactions to update
 */
export const updateReactions = async (
  originalMessage: OriginalMessage,
  reactions: { [key: string]: string[] },
): Promise<void> => {
  // Get all broadcast messages for this original message
  const broadcastedMessages = Object.values(
    await getBroadcasts(originalMessage.messageId, originalMessage.hubId),
  );

  // Get all connections for these broadcast messages
  const connections = await db.connection.findMany({
    where: {
      channelId: { in: broadcastedMessages.map((c) => c.channelId) },
      connected: true,
    },
  });

  // Sort reactions by count
  const sortedReactions = sortReactions(reactions);

  // Create reaction buttons
  const reactionRow = createReactionButtons(sortedReactions);

  // Update each broadcast message
  for (const connection of connections) {
    const dbMsg = broadcastedMessages.find(
      (e) => e.channelId === connection.channelId,
    );
    if (!dbMsg) continue;

    try {
      // Use the API endpoint to fetch and update the message
      const response = await fetch(
        `http://localhost:${process.env.PORT || 3000}/webhook/message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhookUrl: connection.webhookURL,
            messageId: dbMsg.messageId,
            threadId: connection.parentId ? connection.channelId : undefined,
            action: 'fetch',
          }),
        },
      );

      if (!response.ok) continue;

      const message = await response.json();
      if (!message.data) continue;

      // Update the message components
      const updatedComponents = updateMessageComponents(
        message.data.components || [],
        reactionRow,
      );

      // Use the API endpoint to edit the message
      await fetch(
        `http://localhost:${process.env.PORT || 3000}/webhook/message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhookUrl: connection.webhookURL,
            messageId: dbMsg.messageId,
            threadId: connection.parentId ? connection.channelId : undefined,
            action: 'edit',
            data: {
              components: updatedComponents,
            },
          }),
        },
      );
    }
    catch {
      // Silently fail if we can't update a message
    }
  }
};

/**
 * Store updated reactions in the database
 * @param originalMessage The original message
 * @param reactions The reactions to store
 */
export const storeReactions = async (
  originalMessage: OriginalMessage,
  reactions: { [key: string]: string[] },
): Promise<void> => {
  await storeMessage(originalMessage.messageId, {
    ...originalMessage,
    reactions,
  });
};

/**
 * Add native Discord reactions to the original message
 * @param client Discord client instance with cluster support
 * @param originalMessage The original message data
 * @param reactions The reactions to add
 */
export const addNativeReactions = async (
  client: Client,
  originalMessage: OriginalMessage,
  reactions: { [key: string]: string[] },
): Promise<void> => {
  try {
    // Check if the client has cluster support
    if (!('cluster' in client)) return;

    // Create a context object with all the data needed for the eval
    const context = {
      channelId: originalMessage.channelId,
      messageId: originalMessage.messageId,
      _reactions: JSON.stringify(reactions),
    };
    const shardId = calculateShardId(
      originalMessage.guildId,
      client.cluster.info.TOTAL_SHARDS,
    );

    // Execute the eval only on the specific shard that has access to the message
    await client.cluster.broadcastEval(
      async (c, { channelId, messageId, _reactions }) => {
        try {
          // Parse the reactions
          const reactionData = JSON.parse(_reactions);

          // Try to get the channel
          const channel = await c.channels.fetch(channelId).catch(() => null);
          if (!channel || !('messages' in channel)) return false;

          // Try to get the message
          const message = await channel.messages
            .fetch(messageId)
            .catch(() => null);
          if (!message) return false;

          // Get all current reactions on the message
          const currentReactions = message.reactions.cache.map((reaction) =>
            reaction.emoji.toString(),
          );

          // For each reaction in our data, add it to the message if not already present
          for (const [emoji, users] of Object.entries(reactionData)) {
            // Make sure users is an array and has entries
            if (
              Array.isArray(users) &&
							users.length > 0 &&
							!currentReactions.includes(emoji)
            ) {
              // Try to add the reaction, but don't throw if it fails
              await message.react(emoji).catch(() => null);
            }
          }

          return true; // Successfully added reactions
        }
        catch {
          return false; // Failed to add reactions
        }
      },
      { context, shard: shardId },
    );
  }
  catch {
    // Silently fail if we can't add native reactions
  }
};
