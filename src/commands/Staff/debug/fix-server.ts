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

import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { handleError } from '#src/utils/Utils.js';

export default class FixServerCommand extends BaseCommand {
  constructor() {
    super({
      name: 'fix-server',
      description: 'Fixes the server data in the database if it is invalid',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context | ComponentContext) {
    // Ensure this is a guild command
    // Check if it's a ComponentContext first
    if (ctx instanceof ComponentContext) {
      await ctx.deferReply({ flags: ['Ephemeral'] });

      try {
        const guild = ctx.guild;
        if (!guild) {
          await ctx.reply({
            content: `${getEmoji('x_icon', ctx.client)} This command can only be used in a server.`,
            flags: ['Ephemeral'],
          });
          return;
        }

        // Check if server exists in database
        const serverData = await db.serverData.findUnique({
          where: { id: guild.id },
        });

        if (serverData) {
          await ctx.reply({
            content: `${getEmoji('tick_icon', ctx.client)} The server is already valid, no action needed.`,
            flags: ['Ephemeral'],
          });
          return;
        }

        // Create server data if it doesn't exist
        await db.serverData.create({
          data: {
            id: guild.id,
            name: guild.name,
            createdAt: new Date(),
            updatedAt: new Date(),
            messageCount: 0,
            lastMessageAt: new Date(),
          },
        });

        await ctx.reply({
          content: `${getEmoji('tick_icon', ctx.client)} Successfully fixed server data in the database.`,
          flags: ['Ephemeral'],
        });
      }
      catch (error) {
        handleError(error, {
          comment: 'Failed to fix server data',
        });

        await ctx.reply({
          content: 'Failed to fix server data. Please try again later.',
          flags: ['Ephemeral'],
        });
      }
      return;
    }

    // Handle regular Context
    if (!ctx.inGuild()) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} This command can only be used in a server.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await ctx.deferReply({ flags: ['Ephemeral'] });

    try {
      // Check if server exists in database
      const serverData = await db.serverData.findUnique({
        where: { id: ctx.guildId },
      });

      if (serverData) {
        await ctx.editOrReply({
          content: `${getEmoji('tick_icon', ctx.client)} The server is already valid, no action needed.`,
        });
        return;
      }

      // Create server data if it doesn't exist
      await db.serverData.create({
        data: {
          id: ctx.guildId,
          name: ctx.guild.name,
          createdAt: new Date(),
          updatedAt: new Date(),
          messageCount: 0,
          lastMessageAt: new Date(),
        },
      });

      await ctx.editOrReply({
        content: `${getEmoji('tick_icon', ctx.client)} Successfully fixed server data in the database.`,
      });
    }
    catch (error) {
      handleError(error, {
        comment: 'Failed to fix server data',
      });

      await ctx.reply({
        content: 'Failed to fix server data. Please try again later.',
        flags: ['Ephemeral'],
      });
    }
  }
}
