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
import { HubValidator } from '#src/modules/HubValidator.js';
import { HubJoinService } from '#src/services/HubJoinService.js';
import { HubCreationData, HubService } from '#src/services/HubService.js';
import { fetchCommands } from '#src/utils/CommandUtils.js';
import Constants from '#src/utils/Constants.js';
import { createComponentContext } from '#src/utils/ContextUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale, handleError } from '#src/utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  chatInputApplicationCommandMention,
  ContainerBuilder,
  EmbedBuilder,
  MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextChannel,
  TextDisplayBuilder,
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
    if (!ctx.inGuild()) {
      ctx.reply({
        content: 'This command can only be used in a server.',
        flags: ['Ephemeral'],
      });
      return false;
    }

    // After inGuild() check, we know guild is not null
    const botMember = ctx.guild!.members.me;
    if (!botMember?.permissions.has(SetupCommand.REQUIRED_PERMISSIONS)) {
      ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Missing Permissions')
            .setDescription(
              stripIndents`
              I need the following permissions to work properly:
              - Manage Webhooks
              - Send Messages
              - Manage Messages
              - Embed Links

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
    try {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      // Add header
      container.addTextDisplayComponents(
        ui.createHeader(
          'InterChat Setup (1/4)',
          stripIndents`
          Welcome to InterChat Setup!

          Let's get your server connected to the InterChat network. This setup will guide you through:
          1. Selecting a channel for InterChat messages
          2. Connecting to or creating a hub
          3. Configuring basic settings
          `,
          'info_icon',
        ),
      );

      // Add separator
      ui.addSeparator(container, SeparatorSpacingSize.Small);

      // Add channel selection section
      container.addTextDisplayComponents(
        ui.createSection(
          'Step 1: Choose a Channel',
          'First, select the channel where you want InterChat messages to appear.\nThis can be any text channel in your server.',
        ),
      );

      // Add channel select menu using action row
      container.addActionRowComponents((row) => {
        const channelSelect = new ChannelSelectMenuBuilder()
          .setCustomId('setup_channel')
          .setChannelTypes([ChannelType.GuildText])
          .setPlaceholder('Select a channel');

        return row.addComponents(channelSelect);
      });

      // Add tips section
      container.addTextDisplayComponents(
        ui.createSubsection(
          'Channel Selection Tips',
          stripIndents`
          - Create a dedicated channel named \`#interchat\` or \`#global-chat\`
          - Make sure the channel is visible to members who should see messages
          - You can connect multiple channels to different hubs later
          `,
          'info_icon',
        ),
      );

      // Add help buttons
      ui.createActionButtons(
        container,
        {
          label: 'Support Server',
          url: Constants.Links.SupportInvite,
          emoji: 'question_icon',
        },
        undefined,
        {
          label: 'Documentation',
          url: `${Constants.Links.Website}/docs/setup`,
          emoji: 'wiki_icon',
        },
      );

      // Send the response with Components v2
      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
      });

      const collector = ctx.channel?.createMessageComponentCollector({
        time: SetupCommand.TIMEOUT,
      });

      collector?.on('collect', async (i) => {
        try {
          if (!i.inCachedGuild()) {
            await i.reply({
              content: 'You must be in a server to use this.',
              flags: ['Ephemeral'],
            });
            return;
          }

          if (i.user.id !== ctx.user.id) {
            await i.reply({
              content: 'This setup is for another user.',
              flags: ['Ephemeral'],
            });
            return;
          }

          const componentCtx = createComponentContext(i);

          switch (componentCtx.customId.prefix) {
            case 'setup_channel':
              await this.handleChannelSelection(componentCtx);
              break;
            case 'join_popular':
              await this.handlePopularHubs(componentCtx);
              break;
            case 'create_hub':
              await this.showHubCreationModal(componentCtx);
              break;
            case 'back_to_hub_choice':
              await this.handleBackToHubChoice(componentCtx);
              break;
            case 'select_hub':
              await this.handleHubSelection(componentCtx);
              break;
            case 'finish_setup':
              await this.finishSetup(componentCtx);
              break;
          }
        }
        catch (error) {
          handleError(error, {
            comment: 'Error handling interaction in setup flow',
          });

          await i
            .reply({
              content: `${getEmoji('x_icon', i.client)} There was an error processing your request. Please try again.`,
              flags: ['Ephemeral'],
            })
            .catch(() => null);
        }
      });

      collector?.on('end', async (_, reason) => {
        if (reason === 'time') {
          await ctx
            .editReply({
              content: 'Setup timed out. Please run the setup command again.',
              embeds: [],
              components: [],
            })
            .catch(() => null);
        }
      });
    }
    catch (error) {
      handleError(error, {
        comment: 'Error starting setup flow',
      });

      await ctx
        .reply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error starting the setup process. Please try again later.`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handleChannelSelection(ctx: ComponentContext): Promise<void> {
    try {
      if (!ctx.isChannelSelectMenu() || !ctx.guildId || !ctx.guild) return;

      const selectedChannel = ctx.channels?.first();
      if (!selectedChannel) {
        await ctx.reply({
          content: `${getEmoji('x_icon', ctx.client)} No channel was selected. Please try again.`,
          flags: ['Ephemeral'],
        });
        return;
      }

      if (selectedChannel.type !== ChannelType.GuildText) {
        await ctx.reply({
          content: `${getEmoji('x_icon', ctx.client)} Please select a text channel. Voice channels, forums, and other channel types are not supported.`,
          flags: ['Ephemeral'],
        });
        return;
      }

      // Check if the bot has necessary permissions in the channel
      if (
        !ctx.guild.members.me
          ?.permissionsIn(selectedChannel as TextChannel)
          .has(SetupCommand.REQUIRED_PERMISSIONS)
      ) {
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ Missing Channel Permissions')
              .setDescription(
                stripIndents`
                I need the following permissions in ${selectedChannel}:
                - Manage Webhooks
                - Send Messages
                - Manage Messages
                - Embed Links

                Please update the channel permissions and try again!
                `,
              )
              .setColor('Red'),
          ],
          flags: ['Ephemeral'],
        });
        return;
      }

      // Check if channel is already connected to a hub
      const existingConnection = await db.connection.findFirst({
        where: { channelId: selectedChannel.id },
        include: { hub: { select: { name: true } } },
      });

      if (existingConnection) {
        await ctx.reply({
          content: `${getEmoji('x_icon', ctx.client)} This channel is already connected to the hub "${existingConnection.hub.name}". Please select a different channel.`,
          flags: ['Ephemeral'],
        });
        return;
      }

      // Check if server already has connections to other hubs
      const serverConnections = await db.connection.findMany({
        where: { serverId: ctx.guildId },
        include: { hub: { select: { name: true } } },
      });

      if (serverConnections.length > 0) {
        // Show a notice about existing connections
        const connectionList = serverConnections
          .map((conn) => `• **${conn.hub.name}** in <#${conn.channelId}>`)
          .join('\n');

        const embed = new EmbedBuilder()
          .setTitle('Existing Connections')
          .setDescription(
            stripIndents`
            Your server is already connected to the following hubs:

            ${connectionList}

            You can continue to add more connections if you'd like.
            `,
          )
          .setColor(Constants.Colors.primary);

        await ctx.reply({
          embeds: [embed],
          flags: ['Ephemeral'],
        });

        // Wait a moment before showing the hub choice screen
        setTimeout(async () => {
          await this.showHubChoiceScreen(ctx, selectedChannel as TextChannel);
        }, 3000);
        return;
      }

      await this.showHubChoiceScreen(ctx, selectedChannel as TextChannel);
    }
    catch (error) {
      handleError(error, {
        comment: 'Error in handleChannelSelection',
      });

      await ctx
        .reply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error processing your channel selection. Please try again.`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handlePopularHubs(ctx: ComponentContext): Promise<void> {
    if (!ctx.inGuild()) return;

    try {
      const [channelId] = ctx.customId.args;

      // Get server's existing connections to exclude those hubs
      const existingConnections = await db.connection.findMany({
        where: { serverId: ctx.guildId! }, // guildId is guaranteed to be non-null after inGuild() check
        select: { hubId: true },
      });
      const connectedHubIds = existingConnections.map((conn) => conn.hubId);

      const popularHubs = await this.hubService.getPopularHubs(5);

      // Filter out hubs that the server is already connected to
      const availableHubs = popularHubs.filter(({ hub }) => !connectedHubIds.includes(hub.id));

      if (availableHubs.length === 0) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create container for Components v2
        const container = ui.createWarningMessage(
          'No Available Hubs',
          'Your server is already connected to all available popular hubs! Try creating a new hub instead.',
        );

        // Add back button
        ui.createActionButtons(container, {
          label: 'Go Back',
          customId: `back_to_hub_choice:${channelId}`,
          emoji: '⬅️',
        });

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
        return;
      }

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      // Add header
      container.addTextDisplayComponents(
        ui.createHeader(
          'InterChat Setup (2/4)',
          'Choose a hub to join from our most active communities:',
          'info_icon',
        ),
      );

      // Add separator
      ui.addSeparator(container, SeparatorSpacingSize.Small);

      // Add hub descriptions
      const hubDescriptions = availableHubs
        .map(
          ({ hub, totalConnections }) =>
            `### ${hub.data.name}\n${hub.data.description}\n👥 ${totalConnections} servers\n`,
        )
        .join('\n');

      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(hubDescriptions));

      // Add hub select menu
      container.addActionRowComponents((row) => {
        const hubSelect = new StringSelectMenuBuilder()
          .setCustomId('select_hub')
          .setPlaceholder('Choose a hub to join')
          .addOptions(
            availableHubs.map(({ hub, totalConnections }) => ({
              label: hub.data.name,
              description: `${totalConnections} connected servers`,
              value: `${hub.id}|${channelId}`,
              emoji: '👥',
            })),
          );

        return row.addComponents(hubSelect);
      });

      // Add tip about joining more hubs later
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '> **Tip:** You can always join more hubs later using `/connect` and [the hub list](https://interchat.app/hubs).',
        ),
      );

      // Add back button
      ui.createActionButtons(container, {
        label: 'Go Back',
        customId: `back_to_hub_choice:${channelId}`,
        emoji: '⬅️',
      });

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      handleError(error, {
        comment: 'Error in handlePopularHubs',
      });

      await ctx
        .editReply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error loading popular hubs. Please try again.`,
          components: [],
        })
        .catch(() => null);
    }
  }

  private async handleHubSelection(ctx: ComponentContext): Promise<void> {
    if (!ctx.isStringSelectMenu()) return;

    const values = ctx.values;
    if (!values || values.length === 0) return;

    const [selectedHubId, selectedChannelId] = values[0].split('|');

    const hub = await this.hubService.fetchHub(selectedHubId);
    if (!hub) {
      await ctx.editReply({
        content: 'This hub no longer exists. Please choose another one.',
        components: [],
      });
      return;
    }

    await this.showNextSteps(ctx, 'joined', hub.data.name, selectedHubId, selectedChannelId);
  }

  private async showHubCreationModal(ctx: ComponentContext): Promise<void> {
    const [channelId] = ctx.customId.args;

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

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('setup_hub_create_modal')
  async handleHubCreation(ctx: ComponentContext): Promise<void> {
    const locale = await fetchUserLocale(ctx.user.id);
    const [channelId] = ctx.customId.args;

    const hubData: HubCreationData = {
      name: ctx.getModalFieldValue('hub_name') as string,
      description: ctx.getModalFieldValue('hub_description') as string,
      ownerId: ctx.user.id,
    };

    const hubValidator = new HubValidator(locale, ctx.client);

    // Get existing hubs for limit validation
    const existingHubs = await this.hubService.getOwnedHubs(ctx.user.id);

    // Validate the new hub
    const validationResult = await hubValidator.validateNewHub(hubData, existingHubs);

    if (!validationResult.isValid) {
      await ctx.reply({
        content: validationResult.error,
        flags: ['Ephemeral'],
      });
      return;
    }

    try {
      const hub = await this.hubService.createHub(hubData);
      await this.showNextSteps(ctx, 'created', hubData.name, hub.id, channelId);
    }
    catch {
      await ctx.reply({
        content: 'Failed to create hub. Please try again.',
        flags: ['Ephemeral'],
      });
    }
  }

  private async showNextSteps(
    ctx: ComponentContext,
    type: 'created' | 'joined',
    hubName: string,
    hubId: string,
    selectedChannelId: string,
  ): Promise<void> {
    try {
      if (!ctx.replied && !ctx.deferred) {
        await ctx.deferUpdate();
      }

      const applicationCommands = await fetchCommands(ctx.client);
      const hubCommand = applicationCommands?.find((cmd) => cmd.name === 'hub');
      const connectionCommand = applicationCommands?.find((cmd) => cmd.name === 'connection');

      if (!hubCommand || !connectionCommand) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create error container
        const container = ui.createErrorMessage(
          'Command Loading Error',
          'Failed to load commands. Please try again or join our support server for help.',
        );

        // Add support server button
        ui.createActionButtons(container, {
          label: 'Support Server',
          url: Constants.Links.SupportInvite,
          emoji: 'question_icon',
        });

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
        return;
      }

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      const dot = getEmoji('dot', ctx.client);

      if (type === 'created') {
        // Add header for created hub
        container.addTextDisplayComponents(
          ui.createHeader(
            '✨ Almost Done!',
            `Your Hub "${hubName}" is Ready!\nClick Finish Setup to complete the process. After that, follow these steps:`,
            'tick_icon',
          ),
        );

        // Add separator
        ui.addSeparator(container, SeparatorSpacingSize.Small);

        // Add invite link section
        container.addTextDisplayComponents(
          ui.createSubsection(
            '1️⃣ Create an Invite Link',
            stripIndents`
            ${chatInputApplicationCommandMention('hub', 'invite', 'create', hubCommand.id)} \`hub:${hubName}\`
            This will generate an invite link you can share with other servers
            `,
          ),
        );

        // Add share hub section
        container.addTextDisplayComponents(
          ui.createSubsection(
            '2️⃣ Share Your Hub',
            stripIndents`
            Share the invite link with at least one other server to start chatting!
            ${dot} Send to your friends & servers
            ${dot} Share in our [support server](${Constants.Links.SupportInvite})
            `,
          ),
        );

        // Add configuration section
        container.addTextDisplayComponents(
          ui.createSubsection(
            '3️⃣ Essential Configuration',
            stripIndents`
            ${chatInputApplicationCommandMention('hub', 'config', 'rules', hubCommand.id)}
            Create hub rules and guidelines

            ${chatInputApplicationCommandMention('hub', 'config', 'logging', hubCommand.id)}
            Set up logging channels for hub events

            ${chatInputApplicationCommandMention('hub', 'config', 'anti-swear', hubCommand.id)}
            Configure word filters and auto-moderation

            ${chatInputApplicationCommandMention('hub', 'config', 'settings', hubCommand.id)}
            Manage message types and notifications
            `,
          ),
        );

        // Add pro tips section
        container.addTextDisplayComponents(
          ui.createSubsection(
            '💡 Pro Tips',
            stripIndents`
            ${dot} Your hub is private by default - only servers with invites can join
            ${dot} Vote for InterChat to unlock custom welcome messages and colors
            ${dot} You can publish your hub to the [hub directory](${Constants.Links.Website}/hubs) using ${chatInputApplicationCommandMention('hub', 'visibility', hubCommand.id)}
            ${dot} Join our [support server](${Constants.Links.SupportInvite}) for hub management tips!
            `,
          ),
        );

        // Add copy invite command button
        container.addActionRowComponents((row) => {
          const copyButton = new ButtonBuilder()
            .setLabel('Copy Invite Command')
            .setEmoji('📋')
            .setCustomId(`copy_invite_command:${hubName}`)
            .setStyle(ButtonStyle.Secondary);

          return row.addComponents(copyButton);
        });

        // Add help buttons
        ui.createActionButtons(
          container,
          {
            label: 'Finish Setup',
            customId: new CustomID('finish_setup', [hubId, selectedChannelId]).toString(),
            emoji: 'tick_icon',
          },
          {
            label: 'Hub Directory',
            url: `${Constants.Links.Website}/hubs`,
            emoji: 'globe_icon',
          },
          {
            label: 'Support Server',
            url: Constants.Links.SupportInvite,
            emoji: 'question_icon',
          },
        );

        // Update the message with Components v2
        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });

        // Register a one-time collector for the copy command button
        // Check if the interaction is a MessageComponentInteraction which has a message property
        if ('message' in ctx.interaction) {
          const message = ctx.interaction.message;
          const collector = message?.createMessageComponentCollector({
            filter: (i: MessageComponentInteraction) => i.customId.startsWith('copy_invite_command'),
            time: 300000,
          });

          collector?.on('collect', async (i: MessageComponentInteraction) => {
            if (i.user.id !== ctx.user.id) return;
            await i.reply({
              content: `\`/hub invite create hub:${hubName}\`\n✨ Command copied! Run this to create an invite link.`,
              flags: ['Ephemeral'],
            });
          });
        }
      }
      else {
        // Add header for joined hub
        container.addTextDisplayComponents(
          ui.createHeader(
            '✨ Ready to Join?',
            `Ready to Join "${hubName}"?\nClick Finish Setup to join the hub. After joining, you can use these commands:`,
            'tick_icon',
          ),
        );

        // Add separator
        ui.addSeparator(container, SeparatorSpacingSize.Small);

        // Add commands section
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            stripIndents`
            ${chatInputApplicationCommandMention('connection', 'edit', connectionCommand.id)}
            Customize how you receive/send messages to the hub

            ${chatInputApplicationCommandMention('connection', 'list', connectionCommand.id)}
            View all your connected hubs

            ${Constants.Links.Website}/hubs (New :sparkles:)
            Join more hubs
            `,
          ),
        );

        // Add help section
        container.addTextDisplayComponents(
          ui.createSubsection(
            'Need Help?',
            `Join our [support server](${Constants.Links.SupportInvite}) if you have questions!`,
          ),
        );

        // Add help buttons
        ui.createActionButtons(
          container,
          {
            label: 'Finish Setup',
            customId: new CustomID('finish_setup', [hubId, selectedChannelId]).toString(),
            emoji: 'tick_icon',
          },
          {
            label: 'Find More Hubs',
            url: `${Constants.Links.Website}/hubs`,
            emoji: 'globe_icon',
          },
          {
            label: 'Support Server',
            url: Constants.Links.SupportInvite,
            emoji: 'question_icon',
          },
        );

        // Update the message with Components v2
        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
    }
    catch (error) {
      handleError(error, {
        comment: 'Error in showNextSteps',
      });

      await ctx
        .editReply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error showing the next steps. Please try again.`,
          components: [],
        })
        .catch(() => null);
    }
  }

  private async finishSetup(ctx: ComponentContext): Promise<void> {
    const [hubId, channelId] = ctx.customId.args;

    const channel = ctx.guild?.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Channel Not Found',
        'Selected channel no longer exists. Please run the setup command again.',
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    try {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create success container
      const container = ui.createSuccessMessage(
        'Setup Complete!',
        `Your server has been successfully connected to the hub in ${channel}. You can now start chatting!`,
      );

      // Add help buttons
      ui.createActionButtons(
        container,
        {
          label: 'View Channel',
          url: `https://discord.com/channels/${ctx.guildId}/${channelId}`,
          emoji: 'channel_icon',
        },
        undefined,
        {
          label: 'Support Server',
          url: Constants.Links.SupportInvite,
          emoji: 'question_icon',
        },
      );

      // Update the message with Components v2
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });

      // Join the hub using HubJoinService with the interaction directly
      const hubJoinService = new HubJoinService(ctx, await fetchUserLocale(ctx.user.id));

      await hubJoinService.joinHub(channel, { hubId });
    }
    catch (error) {
      handleError(error, {
        comment: 'Failed to complete setup process',
      });

      await ctx
        .reply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error completing the setup. Please try again or contact support if the issue persists.`,
          flags: ['Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handleBackToHubChoice(ctx: ComponentContext): Promise<void> {
    const channel = await ctx.guild?.channels.fetch(ctx.customId.args[0]).catch(() => null);

    if (channel?.type !== ChannelType.GuildText) {
      await ctx.editReply({
        content: 'Selected channel no longer exists. Please run the setup command again.',
        embeds: [],
        components: [],
      });
      return;
    }

    await this.showHubChoiceScreen(ctx, channel);
  }

  private async showHubChoiceScreen(ctx: ComponentContext, channel: TextChannel): Promise<void> {
    try {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      // Add header
      container.addTextDisplayComponents(
        ui.createHeader(
          'InterChat Setup (2/4)',
          `Great! Messages will appear in ${channel}. Now, let's connect to a hub!`,
          'info_icon',
        ),
      );

      // Add separator
      ui.addSeparator(container, SeparatorSpacingSize.Small);

      // Add what is a hub section
      container.addTextDisplayComponents(
        ui.createSection(
          'What is a Hub?',
          'A hub is a shared chat space where multiple servers can talk together. Think of it like a bridge connecting different Discord servers.',
        ),
      );

      // Add hub types section
      container.addTextDisplayComponents(
        ui.createSubsection(
          'Popular Hubs',
          stripIndents`
          - Join existing active communities
          - Start chatting immediately
          - Great for new users
          - No setup required
          `,
        ),
      );

      container.addTextDisplayComponents(
        ui.createSubsection(
          'Create Your Own Hub',
          stripIndents`
          - Start a fresh community
          - Full control over settings
          - Invite specific servers
          - Set your own rules
          `,
        ),
      );

      // Add note about joining more hubs later
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '> You can always join more hubs later with the `/connect` command!',
        ),
      );

      // Add hub choice buttons
      container.addActionRowComponents((row) => {
        const joinPopularButton = new ButtonBuilder()
          .setCustomId(`join_popular:${channel.id}`)
          .setLabel('Join Popular Hub')
          .setEmoji('🌟')
          .setStyle(ButtonStyle.Primary);

        const createHubButton = new ButtonBuilder()
          .setCustomId(`create_hub:${channel.id}`)
          .setLabel('Create New Hub')
          .setEmoji('🆕')
          .setStyle(ButtonStyle.Secondary);

        return row.addComponents(joinPopularButton, createHubButton);
      });

      // Add help buttons
      ui.createActionButtons(
        container,
        {
          label: 'Hub Directory',
          url: `${Constants.Links.Website}/hubs`,
          emoji: 'search_icon',
        },
        undefined,
        {
          label: 'Learn More',
          url: `${Constants.Links.Website}/docs/hubs`,
          emoji: 'book_icon',
        },
      );

      await ctx.editReply({ components: [container], flags: [MessageFlags.IsComponentsV2] });
    }
    catch (error) {
      handleError(error, {
        comment: 'Error in showHubChoiceScreen',
      });

      await ctx
        .editReply({
          content: `${getEmoji('x_icon', ctx.client)} There was an error showing the hub selection screen. Please try again.`,
          components: [],
        })
        .catch(() => null);
    }
  }
}
