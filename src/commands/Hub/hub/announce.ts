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
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { sendToHub } from '#src/utils/hub/utils.js';

import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import type Context from '#src/core/CommandContext/Context.js';
import BaseCommand from '#src/core/BaseCommand.js';
import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';

export default class AnnounceCommand extends BaseCommand {
  private readonly hubService = new HubService();
  readonly cooldown = 1 * 60 * 1000;

  constructor() {
    super({
      name: 'announce',
      description: '📢 Send an announcement to a hub you moderate.',
      types: { slash: true, prefix: true },
      options: [hubOption],
    });
  }
  async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub');
    if (!hubName) {
      await ctx.replyEmbed('hub.notFound_mod', {
        flags: ['Ephemeral'],
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);

    if (!hub || !(await hub.isMod(ctx.user.id))) {
      await ctx.replyEmbed('hub.notFound_mod', {
        flags: ['Ephemeral'],
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(new CustomID('hub_announce', [hub.id]).toString())
      .setTitle('Announce something to all connected servers')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('announcement')
            .setLabel('Announcement')
            .setPlaceholder('Enter your announcement here')
            .setRequired(true)
            .setMinLength(5)
            .setStyle(TextInputStyle.Paragraph),
        ),
      );

    await ctx.showModal(modal);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getModeratedHubs(
      focusedValue,
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }

  @RegisterInteractionHandler('hub_announce')
  async handleAnnounceModal(ctx: ComponentContext) {
    if (!ctx.isModalSubmit()) return;

    const announcement = ctx.getModalFieldValue('announcement');

    if (announcement.length > 4000) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Announcement cannot exceed 4000 characters.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await ctx.reply(
      `${getEmoji('loading', ctx.client)} Sending announcement to all connected servers...`,
    );
    const [hubId] = ctx.customId.args;
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(hubId);

    if (!hub) {
      await ctx.editReply(`${getEmoji('x_icon', ctx.client)} Hub not found.`);
      return;
    }

    await sendToHub(hubId, {
      username: hub.data.name ?? 'InterChat Hub Announcement',
      avatarURL: hub.data.iconUrl,
      embeds: [
        new EmbedBuilder()
          .setTitle('📢 Official Hub Announcement')
          .setDescription(announcement)
          .setColor('#3b82f6')
          .setTimestamp(),
      ],
    });

    await ctx.editReply(
      `${getEmoji('tick_icon', ctx.client)} Announcement sent to all connected servers.`,
    );
  }
}
