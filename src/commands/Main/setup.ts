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
import AchievementService from '#src/services/AchievementService.js';
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
import { t } from '#src/utils/Locale.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  chatInputApplicationCommandMention,
  ContainerBuilder,
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
    if (!(await this.validateSetupPrerequisites(ctx))) return;
    await this.startSetupFlow(ctx);
  }

  private async validateSetupPrerequisites(ctx: Context): Promise<boolean> {
    const locale = await ctx.getLocale();

    if (!ctx.inGuild()) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Server Only Command',
        t('commands.setup.errors.serverOnly', locale),
      );

      ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
      });
      return false;
    }

    // After inGuild() check, we know guild is not null
    const botMember = ctx.guild!.members.me;
    if (!botMember?.permissions.has(SetupCommand.REQUIRED_PERMISSIONS)) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        '❌ Missing Permissions',
        t('commands.setup.errors.missingPermissions', locale, {
          supportInvite: Constants.Links.SupportInvite,
        }),
      );

      ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
      });
      return false;
    }

    return true;
  }

  private async startSetupFlow(ctx: Context): Promise<void> {
    try {
      const locale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      // Add header
      container.addTextDisplayComponents(
        ui.createHeader(
          t('commands.setup.welcome.title', locale),
          t('commands.setup.welcome.description', locale),
          'info_icon',
        ),
      );

      // Add separator
      ui.addSeparator(container, SeparatorSpacingSize.Small);

      // Add channel selection section
      container.addTextDisplayComponents(
        ui.createSection(
          t('commands.setup.channelSelection.title', locale),
          t('commands.setup.channelSelection.description', locale),
        ),
      );

      // Add channel select menu using action row
      container.addActionRowComponents((row) => {
        const channelSelect = new ChannelSelectMenuBuilder()
          .setCustomId(new CustomID('setup_channel').toString())
          .setChannelTypes([ChannelType.GuildText])
          .setPlaceholder(t('commands.setup.channelSelection.placeholder', locale));

        return row.addComponents(channelSelect);
      });

      // Add tips section
      container.addTextDisplayComponents(
        ui.createSubsection(
          t('commands.setup.channelSelection.tips.title', locale),
          t('commands.setup.channelSelection.tips.content', locale),
          'info_icon',
        ),
      );

      // Add help buttons
      ui.createActionButtons(
        container,
        {
          label: t('commands.setup.buttons.supportServer', locale),
          url: Constants.Links.SupportInvite,
          emoji: 'question_icon',
        },
        undefined,
        {
          label: t('commands.setup.buttons.documentation', locale),
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
            const userLocale = await fetchUserLocale(i.user.id);
            await i.reply({
              content: t('commands.setup.errors.serverRequired', userLocale),
              flags: ['Ephemeral'],
            });
            return;
          }

          if (i.user.id !== ctx.user.id) {
            const userLocale = await fetchUserLocale(i.user.id);
            await i.reply({
              content: t('commands.setup.errors.userMismatch', userLocale),
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

          const userLocale = await fetchUserLocale(i.user.id);
          await i
            .reply({
              content: t('commands.setup.errors.interactionError', userLocale, {
                emoji: getEmoji('x_icon', i.client),
              }),
              flags: ['Ephemeral'],
            })
            .catch(() => null);
        }
      });

      collector?.on('end', async (_, reason) => {
        if (reason === 'time') {
          // Create UI components helper
          const end_ui = new UIComponents(ctx.client);

          // Create timeout message container
          const end_container = end_ui.createWarningMessage(
            '⏰ Setup Paused',
            t('commands.setup.errors.timeout', locale),
          );

          await ctx
            .editReply({
              components: [end_container],
              flags: [MessageFlags.IsComponentsV2],
            })
            .catch(() => null);
        }
      });
    }
    catch (error) {
      handleError(error, {
        comment: 'Error starting setup flow',
      });

      const errorLocale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Setup Error',
        t('commands.setup.errors.setupError', errorLocale),
      );

      await ctx
        .reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handleChannelSelection(ctx: ComponentContext): Promise<void> {
    try {
      if (!ctx.isChannelSelectMenu() || !ctx.guildId || !ctx.guild) return;

      const locale = await ctx.getLocale();
      const selectedChannel = ctx.channels?.first();
      if (!selectedChannel) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create error container
        const container = ui.createErrorMessage(
          'No Channel Selected',
          t('commands.setup.errors.channelNotSelected', locale),
        );

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        });
        return;
      }

      if (selectedChannel.type !== ChannelType.GuildText) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create error container
        const container = ui.createErrorMessage(
          'Invalid Channel Type',
          t('commands.setup.errors.invalidChannelType', locale),
        );

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        });
        return;
      }

      // Check if the bot has necessary permissions in the channel
      if (
        !ctx.guild.members.me
          ?.permissionsIn(selectedChannel as TextChannel)
          .has(SetupCommand.REQUIRED_PERMISSIONS)
      ) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create error container
        const container = ui.createErrorMessage(
          '❌ Missing Channel Permissions',
          t('commands.setup.errors.missingChannelPermissions', locale, {
            channel: selectedChannel.toString(),
          }),
        );

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        });
        return;
      }

      // Check if channel is already connected to a hub
      const existingConnection = await db.connection.findFirst({
        where: { channelId: selectedChannel.id },
        include: { hub: { select: { name: true } } },
      });

      if (existingConnection) {
        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create error container
        const container = ui.createErrorMessage(
          'Channel Already Connected',
          t('commands.setup.errors.channelAlreadyConnected', locale, {
            hubName: existingConnection.hub.name,
          }),
        );

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
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

        // Create UI components helper
        const ui = new UIComponents(ctx.client);

        // Create info container
        const container = new ContainerBuilder();

        // Add header
        container.addTextDisplayComponents(
          ui.createHeader(
            t('commands.setup.existingConnections.title', locale),
            t('commands.setup.existingConnections.description', locale, {
              connectionList,
            }),
            'info_icon',
          ),
        );

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
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

      const errorLocale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Error',
        t('commands.setup.errors.completionError', errorLocale),
      );

      await ctx
        .reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handlePopularHubs(ctx: ComponentContext): Promise<void> {
    if (!ctx.inGuild()) return;

    try {
      const locale = await ctx.getLocale();
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
          t('commands.setup.errors.noAvailableHubs', locale),
        );

        // Add back button
        ui.createActionButtons(container, {
          label: t('commands.setup.buttons.goBack', locale),
          customId: new CustomID(`back_to_hub_choice:${channelId}`).toString(),
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
          t('commands.setup.hubSelection.title', locale),
          t('commands.setup.hubSelection.description', locale),
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
          .setCustomId(new CustomID('select_hub').setArgs(channelId).toString())
          .setPlaceholder(t('commands.setup.hubSelection.placeholder', locale))
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
        new TextDisplayBuilder().setContent(t('commands.setup.hubSelection.tip', locale)),
      );

      // Add back button
      ui.createActionButtons(container, {
        label: t('commands.setup.buttons.goBack', locale),
        customId: new CustomID(`back_to_hub_choice:${channelId}`).toString(),
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

      const errorLocale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        t('errors.unknown', errorLocale),
        t('commands.setup.errors.commandLoadingError', errorLocale),
      );

      await ctx
        .editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        })
        .catch(() => null);
    }
  }

  private async handleHubSelection(ctx: ComponentContext): Promise<void> {
    if (!ctx.isStringSelectMenu()) return;

    const values = ctx.values;
    if (!values || values.length === 0) return;

    const locale = await ctx.getLocale();
    const [selectedHubId, selectedChannelId] = values[0].split('|');

    const hub = await this.hubService.fetchHub(selectedHubId);
    if (!hub) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Hub Not Found',
        t('commands.setup.errors.hubNotFound', locale),
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
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
    const locale = await ctx.getLocale();
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
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Validation Error',
        validationResult.error || 'Invalid hub data provided. Please try again.',
      );

      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
      });
      return;
    }

    try {
      const hub = await this.hubService.createHub(hubData);

      // Track Hub Creator achievement
      const achievementService = new AchievementService();
      await achievementService.processEvent('hub_create', { userId: ctx.user.id }, ctx.client);

      await this.showNextSteps(ctx, 'created', hubData.name, hub.id, channelId);
    }
    catch {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Hub Creation Failed',
        'Failed to create hub. Please try again.',
      );

      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
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
            .setCustomId(new CustomID(`copy_invite_command:${hubName}`).toString())
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
            filter: (i: MessageComponentInteraction) =>
              i.customId.startsWith('copy_invite_command'),
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

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Error',
        'There was an error showing the next steps. Please try again.',
      );

      await ctx
        .editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
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

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        'Setup Error',
        'There was an error completing the setup. Please try again or contact support if the issue persists.',
      );

      await ctx
        .reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
        })
        .catch(() => null);
    }
  }

  private async handleBackToHubChoice(ctx: ComponentContext): Promise<void> {
    const channel = await ctx.guild?.channels.fetch(ctx.customId.args[0]).catch(() => null);

    if (channel?.type !== ChannelType.GuildText) {
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

    await this.showHubChoiceScreen(ctx, channel);
  }

  private async showHubChoiceScreen(ctx: ComponentContext, channel: TextChannel): Promise<void> {
    try {
      const locale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create container for Components v2
      const container = new ContainerBuilder();

      // Add header
      container.addTextDisplayComponents(
        ui.createHeader(
          t('commands.setup.hubChoice.title', locale),
          t('commands.setup.hubChoice.description', locale, { channel: channel.toString() }),
          'info_icon',
        ),
      );

      // Add separator
      ui.addSeparator(container, SeparatorSpacingSize.Small);

      // Add what is a hub section
      container.addTextDisplayComponents(
        ui.createSection(
          t('commands.setup.hubChoice.whatIsHub.title', locale),
          t('commands.setup.hubChoice.whatIsHub.description', locale),
        ),
      );

      // Add hub types section
      container.addTextDisplayComponents(
        ui.createSubsection(
          t('commands.setup.hubChoice.popularHubs.title', locale),
          t('commands.setup.hubChoice.popularHubs.description', locale),
        ),
      );

      container.addTextDisplayComponents(
        ui.createSubsection(
          t('commands.setup.hubChoice.createHub.title', locale),
          t('commands.setup.hubChoice.createHub.description', locale),
        ),
      );

      // Add note about joining more hubs later
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('commands.setup.hubChoice.note', locale)),
      );

      // Add hub choice buttons
      container.addActionRowComponents((row) => {
        const joinPopularButton = new ButtonBuilder()
          .setCustomId(new CustomID('join_popular', [channel.id]).toString())
          .setLabel(t('commands.setup.buttons.joinPopularHub', locale))
          .setEmoji({ name: '🌟' }) // Use emoji object format for Unicode emojis
          .setStyle(ButtonStyle.Primary);

        const createHubButton = new ButtonBuilder()
          .setCustomId(new CustomID('create_hub', [channel.id]).toString())
          .setLabel(t('commands.setup.buttons.createNewHub', locale))
          .setEmoji({ name: '🆕' }) // Use emoji object format for Unicode emojis
          .setStyle(ButtonStyle.Secondary);

        return row.addComponents(joinPopularButton, createHubButton);
      });

      // Add help buttons
      ui.createActionButtons(
        container,
        {
          label: t('commands.setup.buttons.hubDirectory', locale),
          url: `${Constants.Links.Website}/hubs`,
          emoji: 'search_icon',
        },
        undefined,
        {
          label: t('commands.setup.buttons.learnMore', locale),
          url: `${Constants.Links.Website}/docs/hubs`,
          emoji: 'info_icon',
        },
      );

      await ctx.editReply({ components: [container], flags: [MessageFlags.IsComponentsV2] });
    }
    catch (error) {
      handleError(error, {
        comment: 'Error in showHubChoiceScreen',
      });

      const errorLocale = await ctx.getLocale();

      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const container = ui.createErrorMessage(
        t('errors.unknown', errorLocale),
        t('commands.setup.errors.setupError', errorLocale),
      );

      await ctx
        .editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        })
        .catch(() => null);
    }
  }
}
