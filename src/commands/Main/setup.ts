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
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubValidator } from '#src/modules/HubValidator.js';
import { HubJoinService } from '#src/services/HubJoinService.js';
import { HubCreationData, HubService } from '#src/services/HubService.js';
import { fetchCommands } from '#src/utils/CommandUtils.js';
import Constants from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  chatInputApplicationCommandMention,
  EmbedBuilder,
  MessageComponentInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class SetupCommand extends BaseCommand {
  private static readonly REQUIRED_PERMISSIONS = [
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.EmbedLinks,
  ];

  private static readonly TIMEOUT = 300000; // 5 minutes

  constructor() {
    super({
      name: 'setup',
      description: 'Setup InterChat in your server',
      contexts: { guildOnly: true },
      types: { slash: true },
    });
  }

  private readonly hubService = new HubService();

  async execute(ctx: Context): Promise<void> {
    if (!this.validateSetupPrerequisites(ctx)) return;
    await this.startSetupFlow(ctx);
  }

  private validateSetupPrerequisites(ctx: Context): boolean {
    if (!ctx.guild) {
      ctx.reply({
        content: 'This command can only be used in a server.',
        flags: ['Ephemeral'],
      });
      return false;
    }

    const botMember = ctx.guild.members.me;
    if (!botMember?.permissions.has(SetupCommand.REQUIRED_PERMISSIONS)) {
      ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Missing Permissions')
            .setDescription(
              stripIndents`
              I need the following permissions to work properly:
              • Manage Webhooks
              • Send Messages
              • Manage Messages
              • Embed Links
              
              Please give me these permissions and try again!
              Need help? [Join our support server](${Constants.Links.SupportInvite})
              `,
            )
            .setColor('Red'),
        ],
        flags: ['Ephemeral'],
      });
      return false;
    }

    return true;
  }

  private async startSetupFlow(ctx: Context): Promise<void> {
    const steps = ['Channel', 'Hub', 'Settings', 'Done'];
    const currentStep = 1;

    const embed = new EmbedBuilder()
      .setTitle('InterChat Setup (1/4)')
      .setDescription(
        stripIndents`
        ### Step 1: Choose a Channel
        First, select the channel where you want InterChat messages to appear.
        This can be any text channel in your server.

        **Tips:**
        • Choose a channel that's easy to find
        • Make sure members can see the channel
        • You can create a new channel just for InterChat
        `,
      )
      .setColor(Constants.Colors.interchat)
      .setFooter({ text: `Step ${currentStep} of ${steps.length}: ${steps[currentStep - 1]}` });

    const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('setup_channel')
        .setChannelTypes([ChannelType.GuildText])
        .setPlaceholder('Select a channel'),
    );

    await ctx.reply({
      embeds: [embed],
      components: [channelRow],
      flags: ['Ephemeral'],
    });

    const collector = ctx.channel?.createMessageComponentCollector({
      time: SetupCommand.TIMEOUT,
    });

    collector?.on('collect', async (i) => {
      if (!i.inCachedGuild()) {
        await i.reply({ content: 'You must be in a server to use this.', flags: ['Ephemeral'] });
        return;
      }

      if (i.user.id !== ctx.user.id) {
        await i.reply({
          content: 'This setup is for another user.',
          flags: ['Ephemeral'],
        });
        return;
      }

      switch (i.customId.split(':')[0]) {
        case 'setup_channel':
          await this.handleChannelSelection(i as ChannelSelectMenuInteraction<'cached'>);
          break;
        case 'join_popular':
          await this.handlePopularHubs(i as ButtonInteraction<'cached'>);
          break;
        case 'create_hub':
          await this.showHubCreationModal(i as ButtonInteraction);
          break;
        case 'back_to_hub_choice':
          await this.handleBackToHubChoice(i as ButtonInteraction);
          break;
        case 'select_hub':
          await this.handleHubSelection(i as StringSelectMenuInteraction);
          break;
        case 'finish_setup':
          await this.finishSetup(i as ButtonInteraction);
          break;
      }
    });

    collector?.on('end', async (_, reason) => {
      if (reason === 'time') {
        await ctx.editReply({
          content: 'Setup timed out. Please run the setup command again.',
          embeds: [],
          components: [],
        });
      }
    });
  }

  private async handleChannelSelection(
    interaction: ChannelSelectMenuInteraction<'cached'>,
  ): Promise<void> {
    const selectedChannel = interaction.channels.first();
    if (selectedChannel?.type !== ChannelType.GuildText) return;

    // Check if channel is already connected to a hub
    const existingConnection = await db.connection.findFirst({
      where: { channelId: selectedChannel.id },
      include: { hub: { select: { name: true } } },
    });

    if (existingConnection) {
      await interaction.reply({
        content: `${getEmoji('x_icon', interaction.client)} This channel is already connected to the hub "${existingConnection.hub.name}". Please select a different channel.`,
        flags: ['Ephemeral'],
        embeds: [],
        components: [],
      });
      return;
    }

    await this.showHubChoiceScreen(interaction, selectedChannel);
  }

  private async handlePopularHubs(interaction: ButtonInteraction<'cached'>): Promise<void> {
    const channelId = interaction.customId.split(':')[1];

    // Get server's existing connections to exclude those hubs
    const existingConnections = await db.connection.findMany({
      where: { serverId: interaction.guildId },
      select: { hubId: true },
    });
    const connectedHubIds = existingConnections.map((conn) => conn.hubId);

    const popularHubs = await this.hubService.getPopularHubs(5);

    // Filter out hubs that the server is already connected to
    const availableHubs = popularHubs.filter(({ hub }) => !connectedHubIds.includes(hub.id));

    if (availableHubs.length === 0) {
      await interaction.update({
        content: `${getEmoji('x_icon', interaction.client)} Your server is already connected to all available popular hubs! Try creating a new hub instead.`,
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('InterChat Setup (2/4)')
      .setDescription(
        stripIndents`
        ### Popular Hubs
        Choose a hub to join from our most active communities:
        
        ${availableHubs
          .map(
            ({ hub, totalConnections }) =>
              `**${hub.data.name}**\n${hub.data.description}\n👥 ${totalConnections} servers\n`,
          )
          .join('\n')}
        
        **Tip:** You can always join more hubs later using \`/hub join\`
        `,
      )
      .setColor(Constants.Colors.interchat)
      .setFooter({ text: 'Step 2 of 4: Hub Selection' });

    const hubSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_hub')
        .setPlaceholder('Choose a hub to join')
        .addOptions(
          availableHubs.map(({ hub, totalConnections }) => ({
            label: hub.data.name,
            description: `${totalConnections} connected servers`,
            value: `${hub.id}|${channelId}`,
            emoji: '👥',
          })),
        ),
    );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`back_to_hub_choice:${channelId}`)
        .setLabel('Go Back')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      embeds: [embed],
      components: [hubSelect, backRow],
    });
  }

  private async handleHubSelection(interaction: StringSelectMenuInteraction): Promise<void> {
    const [selectedHubId, selectedChannelId] = interaction.values[0].split('|');

    const hub = await this.hubService.fetchHub(selectedHubId);
    if (!hub) {
      await interaction.update({
        content: 'This hub no longer exists. Please choose another one.',
        components: [],
      });
      return;
    }

    await this.showNextSteps(
      interaction,
      'joined',
      hub.data.name,
      selectedHubId,
      selectedChannelId,
    );
  }

  private async showHubCreationModal(interaction: ButtonInteraction): Promise<void> {
    const channelId = interaction.customId.split(':')[1];

    const modal = new ModalBuilder()
      .setCustomId(new CustomID('setup_hub_create_modal').setArgs(channelId).toString())
      .setTitle('Create New Hub')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('hub_name')
            .setLabel('Hub Name')
            .setPlaceholder('e.g., Gaming Community, Art Gallery')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(32)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('hub_description')
            .setLabel('Description')
            .setPlaceholder('What is this hub about?')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler('setup_hub_create_modal')
  async handleHubCreation(interaction: ModalSubmitInteraction): Promise<void> {
    const locale = await fetchUserLocale(interaction.user.id);
    const {
      args: [channelId],
    } = CustomID.parseCustomId(interaction.customId);

    const hubData: HubCreationData = {
      name: interaction.fields.getTextInputValue('hub_name'),
      description: interaction.fields.getTextInputValue('hub_description'),
      ownerId: interaction.user.id,
    };

    const hubValidator = new HubValidator(locale, interaction.client);

    // Get existing hubs for limit validation
    const existingHubs = await this.hubService.getOwnedHubs(interaction.user.id);

    // Validate the new hub
    const validationResult = await hubValidator.validateNewHub(hubData, existingHubs);

    if (!validationResult.isValid) {
      await interaction.reply({
        content: validationResult.error,
        ephemeral: true,
      });
      return;
    }

    try {
      const hub = await this.hubService.createHub(hubData);
      await this.showNextSteps(interaction, 'created', hubData.name, hub.id, channelId);
    }
    catch {
      await interaction.reply({
        content: 'Failed to create hub. Please try again.',
        ephemeral: true,
      });
    }
  }

  private async showNextSteps(
    interaction: ModalSubmitInteraction | MessageComponentInteraction,
    type: 'created' | 'joined',
    hubName: string,
    hubId: string,
    selectedChannelId: string,
  ): Promise<void> {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    const applicationCommands = await fetchCommands(interaction.client);
    const hubCommand = applicationCommands?.find((cmd) => cmd.name === 'hub');
    const connectionCommand = applicationCommands?.find((cmd) => cmd.name === 'connection');

    if (!hubCommand || !connectionCommand) {
      await interaction.editReply({
        content: 'Failed to load commands. Please try again or join our support server for help.',
        embeds: [],
        components: [],
      });
      return;
    }

    const dot = getEmoji('dot', interaction.client);

    const embed = new EmbedBuilder()
      .setTitle(type === 'created' ? '✨ Almost Done!' : '✨ Ready to Join?')
      .setColor('Green')
      .setFooter({ text: 'Click Finish Setup to complete the process' });

    if (type === 'created') {
      embed.setDescription(
        stripIndents`
        ### Your Hub "${hubName}" is Ready!
        Click Finish Setup to complete the process. After that, follow these steps:
        
        **1️⃣ Create an Invite Link**
        ${chatInputApplicationCommandMention('hub', 'invite', 'create', hubCommand.id)} \`hub:${hubName}\`
        This will generate an invite link you can share with other servers
        
        **2️⃣ Share Your Hub**
        Share the invite link with at least one other server to start chatting!
        ${dot} Send to your friends & servers
        ${dot} Share in our [support server](${Constants.Links.SupportInvite})
        
        **3️⃣ Essential Configuration**
        ${chatInputApplicationCommandMention('hub', 'config', 'rules', hubCommand.id)}
        Create hub rules and guidelines
        
        ${chatInputApplicationCommandMention('hub', 'config', 'logging', hubCommand.id)}
        Set up logging channels for hub events
        
        ${chatInputApplicationCommandMention('hub', 'config', 'anti-swear', hubCommand.id)}
        Configure word filters and auto-moderation
        
        ${chatInputApplicationCommandMention('hub', 'config', 'settings', hubCommand.id)}
        Manage message types and notifications
        
        **💡 Pro Tips**
        ${dot} Your hub is private by default - only servers with invites can join
        ${dot} Vote for InterChat to unlock custom welcome messages and colors
        ${dot} You can publish your hub to the [hub directory](${Constants.Links.Website}/hubs) using ${chatInputApplicationCommandMention('hub', 'visibility', hubCommand.id)}
        • Join our [support server](${Constants.Links.SupportInvite}) for hub management tips!
        `,
      );

      // Add a button to copy the hub invite command
      const inviteCommandRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Copy Invite Command')
          .setEmoji('📋')
          .setCustomId(`copy_invite_command:${hubName}`)
          .setStyle(ButtonStyle.Secondary),
      );

      const finalRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Hub Directory')
          .setURL(`${Constants.Links.Website}/hubs`)
          .setEmoji('🌐')
          .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
          .setLabel('Support Server')
          .setURL(Constants.Links.SupportInvite)
          .setEmoji('❓')
          .setStyle(ButtonStyle.Link),
      );

      const finishButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.createFinishButton(hubId, selectedChannelId),
      );

      await interaction.editReply({
        embeds: [embed],
        components: [inviteCommandRow, finalRow, finishButton],
      });

      // Register a one-time collector for the copy command button
      const collector = interaction.message?.createMessageComponentCollector({
        filter: (i) => i.customId.startsWith('copy_invite_command'),
        time: 300000,
      });

      collector?.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) return;
        await i.reply({
          content: `\`/hub invite create hub:${hubName}\`\n✨ Command copied! Run this to create an invite link.`,
          ephemeral: true,
        });
      });
    }
    else {
      embed.setDescription(
        stripIndents`
        ### Ready to Join "${hubName}"?
        Click Finish Setup to join the hub. After joining, you can use these commands:
        
        ${chatInputApplicationCommandMention('connection', 'edit', connectionCommand.id)}
        Customize how you receive/send messages to the hub
        
        ${chatInputApplicationCommandMention('connection', 'list', connectionCommand.id)}
        View all your connected hubs
        
        ${Constants.Links.Website}/hubs (New :sparkles:)
        Join more hubs
        
        **Need Help?**
        Join our [support server](${Constants.Links.SupportInvite}) if you have questions!
        `,
      );
    }

    const finalRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Find More Hubs')
        .setURL(`${Constants.Links.Website}/hubs`)
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Support Server')
        .setURL(Constants.Links.SupportInvite)
        .setEmoji('❓')
        .setStyle(ButtonStyle.Link),
    );

    const finishButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      this.createFinishButton(hubId, selectedChannelId),
    );

    const toReply = {
      embeds: [embed],
      components: [finalRow, finishButton],
    };

    if (interaction.isMessageComponent()) await interaction.update(toReply);
    else interaction.editReply(toReply);
  }

  private createFinishButton(hubId: string, channelId: string): ButtonBuilder {
    return new ButtonBuilder()
      .setLabel('Finish Setup')
      .setCustomId(`finish_setup:${hubId}:${channelId}`)
      .setStyle(ButtonStyle.Success);
  }

  private async finishSetup(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) return;

    const [, hubId, channelId] = interaction.customId.split(':');

    const channel = interaction.guild?.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      await interaction.update({
        content: 'Selected channel no longer exists. Please run the setup command again.',
        components: [],
      });
      return;
    }

    // Join the hub using HubJoinService
    const hubJoinService = new HubJoinService(
      interaction,
      await fetchUserLocale(interaction.user.id),
    );
    await hubJoinService.joinHub(channel, { hubId });
  }

  private async handleBackToHubChoice(interaction: ButtonInteraction): Promise<void> {
    const channel = await interaction.guild?.channels
      .fetch(interaction.customId.split(':')[1])
      .catch(() => null);

    if (channel?.type !== ChannelType.GuildText) {
      await interaction.update({
        content: 'Selected channel no longer exists. Please run the setup command again.',
        embeds: [],
        components: [],
      });
      return;
    }

    await this.showHubChoiceScreen(interaction, channel);
  }

  private async showHubChoiceScreen(
    interaction: MessageComponentInteraction,
    channel: TextChannel,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('InterChat Setup (2/4)')
      .setDescription(
        stripIndents`
        ### Step 2: Choose Your Hub
        Great! Messages will appear in ${channel}. Now, let's connect to a hub!

        **What's a hub?**
        A hub is a shared chat space where multiple servers can talk together.
        
        **Choose an option:**
        🌟 **Join Popular Hub** - Perfect for first-time users
        🆕 **Create New Hub** - Start your own community
        `,
      )
      .setColor(Constants.Colors.interchat)
      .setFooter({ text: 'Step 2 of 4: Hub' });

    const hubChoiceRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`join_popular:${channel.id}`)
        .setLabel('Join Popular Hub')
        .setEmoji('🌟')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`create_hub:${channel.id}`)
        .setLabel('Create New Hub')
        .setEmoji('🆕')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      embeds: [embed],
      components: [hubChoiceRow],
    });
  }
}
