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
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubJoinService } from '#src/services/HubJoinService.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import {
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  type AutocompleteInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';

/**
 * Redesigned connect command using the InterChat v5 design system
 */
export default class ConnectCommandV5 extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'connect',
      description: '🔗 Connect your channel to an InterChat hub',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'The channel you want to connect to a hub',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
          ],
        },
        { ...hubOption, required: false },
        {
          type: ApplicationCommandOptionType.String,
          name: 'invite',
          description: 'The invite code of the private hub you want to join',
          required: false,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    if (!ctx.inGuild()) return;

    const ui = new UIComponents(ctx.client);
    const hubInviteOrName =
      ctx.options.getString('invite') ?? ctx.options.getString('hub') ?? undefined;
    const channel = ((await ctx.options.getChannel('channel')) ??
      ctx.channel) as GuildTextBasedChannel;
    const locale = await ctx.getLocale();

    // If no hub name or invite is provided, show the hub selection UI
    if (!hubInviteOrName) {
      return this.showHubSelectionUI(ctx, channel, ui);
    }

    // Join the specified hub
    await ctx.deferReply({ flags: ['Ephemeral'] });
    const hubJoinService = new HubJoinService(ctx, locale);
    await hubJoinService.joinHub(channel, { hubInviteOrName });
  }

  /**
   * Show the hub selection UI
   */
  private async showHubSelectionUI(ctx: Context, channel: GuildTextBasedChannel, ui: UIComponents) {
    // Create container for hub selection
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Connect to a Hub',
        `Choose a hub to connect ${channel} to the InterChat network`,
        'house_icon',
      ),
    );

    // Add separator
    ui.addSeparator(container);

    // Add popular hubs section
    container.addTextDisplayComponents(
      ui.createSection('Popular Hubs', 'Join one of these active communities:'),
    );

    // Fetch popular hubs
    const popularHubs = await this.getPopularHubs();

    // Add hub sections
    for (const hub of popularHubs) {
      const section = new SectionBuilder();

      // Create hub description
      const description = `### ${hub.name}\n${hub.description}\n👥 ${hub.connections} servers connected`;

      // Create join button for this hub
      const joinButton = new ButtonBuilder()
        .setCustomId(
          new CustomID().setIdentifier('connect', 'join').setArgs(hub.id, channel.id).toString(),
        )
        .setLabel('Join Hub')
        .setStyle(ButtonStyle.Primary)
        .setEmoji(getEmoji('connect', ctx.client));

      // Add to section
      section
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
        .setButtonAccessory(joinButton);

      container.addSectionComponents(section);
    }

    // Add options for other ways to connect
    container.addTextDisplayComponents(
      ui.createSection('Other Options', 'Looking for something else?'),
    );

    // Add buttons for other options
    ui.createActionButtons(
      container,
      {
        label: 'Browse All Hub',
        url: `${Constants.Links.Website}/hubs`,
        emoji: 'globe_icon',
      },
      {
        label: 'Create New Hub',
        customId: new CustomID()
          .setIdentifier('connect', 'create')
          .setArgs(channel.id)
          .toString(),
        emoji: 'plus_icon',
      },
    );

    // Add note about private hubs
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '> **Have an invite code?** Use `/connect invite:yourInviteCode` to join a private hub.',
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Get popular hubs for the selection UI
   */
  private async getPopularHubs(
    limit = 3,
  ): Promise<Array<{ id: string; name: string; description: string; connections: number }>> {
    // Get popular public hubs
    const hubs = await db.hub.findMany({
      where: { private: false },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { connections: true } },
      },
      orderBy: { connections: { _count: 'desc' } },
      take: limit,
    });

    return hubs.map((hub) => ({
      id: hub.id,
      name: hub.name,
      description: hub.description,
      connections: hub._count.connections,
    }));
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getPublicHubs(focusedValue, this.hubService);
    await interaction.respond(
      hubChoices.map((hub) => ({ name: hub.data.name, value: hub.data.name })),
    );
  }

  @RegisterInteractionHandler('connect', 'join')
  async handleJoinButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const [hubId, channelId] = ctx.customId.args;

    if (!hubId || !channelId) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Invalid hub or channel ID.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the channel
    const channel = await ctx.guild?.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Channel not found or not a text channel.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Join the hub
    const hubJoinService = new HubJoinService(ctx, 'en');

    await hubJoinService.joinHub(channel as GuildTextBasedChannel, { hubId });
  }

  @RegisterInteractionHandler('connect', 'create')
  async handleCreateButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = ui.createInfoMessage(
      'Create a New Hub',
      'To create your own hub, use the `/hub create` command and follow the prompts.',
    );

    // Add button to create hub
    ui.createActionButtons(container, {
      label: 'Create Hub',
      customId: new CustomID().setIdentifier('connect', 'redirect-create').toString(),
      emoji: 'plus_icon',
    });

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
    });
  }

  @RegisterInteractionHandler('connect', 'redirect-create')
  async handleRedirectCreateButton(ctx: ComponentContext) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    // This would normally redirect to the hub create command
    // For now, just show a message
    await ctx.editReply({
      content:
        'This would normally redirect to the `/hub create` command. Since this is a demo, please use that command directly.',
    });
  }
}
