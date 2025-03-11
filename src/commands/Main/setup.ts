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

import { BlockWord, Role } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ComponentType,
  GuildChannel,
  Message,
  MessageComponentInteraction,
  PermissionFlagsBits,
  Snowflake,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
} from 'discord.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import HubConfigAntiSwearSubcommand from '#src/commands/Main/hub/config/anti-swear.js';
import HubConfigSettingsSubcommand from '#src/commands/Main/hub/config/settings.js';
import HubCreateSubCommand from '#src/commands/Main/hub/create.js';
import { HubService } from '#src/services/HubService.js';
import { HubJoinService } from '#src/services/HubJoinService.js';
import HubManager from '#src/managers/HubManager.js';
import Logger from '#src/utils/Logger.js';
import { fetchUserLocale, getReplyMethod, wait } from '#src/utils/Utils.js';
import { stripIndents } from 'common-tags';

interface SetupResult {
  success: boolean;
}

export default class SetupCommand extends BaseCommand {
  private static readonly REQUIRED_PERMISSIONS = [
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.EmbedLinks,
  ];

  private static readonly BUTTON_TIMEOUT = 60000;
  private static readonly MODAL_TIMEOUT = 120000;

  constructor() {
    super({
      name: 'setup',
      description: 'Setup InterChat for a channel in this server.',
      contexts: { guildOnly: true },
      types: { slash: true },
    });
  }

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
        content:
          'Missing required permissions: Manage Webhooks, Send Messages, Manage Messages, and Embed Links.',
        flags: ['Ephemeral'],
      });
      return false;
    }

    return true;
  }

  private async startSetupFlow(ctx: Context): Promise<void> {
    const hubChoiceRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('create_hub')
        .setLabel('Create New Hub')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('join_hub')
        .setLabel('Join a Hub')
        .setStyle(ButtonStyle.Secondary),
    );

    await ctx.reply({
      content: stripIndents`
        ### Welcome to InterChat Setup!
        To get started, select one of the following options:
        1. **Create New Hub**: Create a new inter-server chat hub. Other servers can join this hub.
        2. **Join a Hub**: Join an existing hub to chat with other servers. (Recommended for first-time users)
      `,
      components: [hubChoiceRow],
      flags: ['Ephemeral'],
    });

    const collector = ctx.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === ctx.user.id,
      time: SetupCommand.BUTTON_TIMEOUT,
      max: 2,
    });

    collector?.on('collect', async (i: ButtonInteraction) => {
      if (i.customId === 'create_hub') await this.handleCreateHub(ctx, i);
      else if (i.customId === 'join_hub') await this.handleJoinHub(i);
    });
  }

  private async handleCreateHub(ctx: Context, interaction: ButtonInteraction): Promise<void> {
    const modal = HubCreateSubCommand.hubCreateModal(await fetchUserLocale(interaction.user.id));
    await interaction.showModal(modal);

    const modalInteraction = await interaction
      .awaitModalSubmit({
        time: SetupCommand.MODAL_TIMEOUT,
      })
      .catch(() => null);

    if (!modalInteraction) {
      await interaction.followUp({
        content: 'Hub creation timed out.',
        components: [],
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!modalInteraction.replied) await wait(2000);

    const hubData = await this.fetchAndDisplayHubSelection(interaction);
    const collector = this.createHubSelectionCollector(ctx, interaction, hubData.continueReply);

    collector?.on('collect', async (i: StringSelectMenuInteraction) => {
      const hub = await this.getSelectedHub(i);
      if (!hub) {
        await i.update({ content: 'Failed to fetch hub.', components: [] });
        return;
      }
      await this.configureHubSettings(ctx, i, hub);
    });
  }

  private async fetchAndDisplayHubSelection(interaction: ButtonInteraction) {
    const hubService = new HubService();
    const hubData = await hubService.getOwnedHubs(interaction.user.id);
    const selectMenuOpts = hubData.map((hub) => ({
      label: hub.data.name,
      value: hub.id,
    }));

    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_hub')
        .setPlaceholder('Select the hub you just created')
        .setOptions(selectMenuOpts),
    );

    const continueReply = await interaction.followUp({
      content: 'Select the hub you just created:',
      components: [selectMenu],
      flags: ['Ephemeral'],
    });

    return { hubData, continueReply };
  }

  private createHubSelectionCollector(
    ctx: Context,
    interaction: ButtonInteraction,
    reply: Message,
  ) {
    return reply?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: SetupCommand.BUTTON_TIMEOUT,
      max: 1,
    });
  }

  private async getSelectedHub(
    interaction: StringSelectMenuInteraction,
  ): Promise<HubManager | null> {
    const hubService = new HubService();
    const hubId = interaction.values[0];
    return await hubService.fetchHub(hubId);
  }

  private async handleJoinHub(interaction: ButtonInteraction): Promise<void> {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('invite_or_name')
        .setLabel('I have an invite code or hub name')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('official')
        .setLabel('It\'s my first time using InterChat')
        .setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.update({
      content: 'Please select an option:',
      components: [buttons],
    });

    const collector = reply?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: SetupCommand.BUTTON_TIMEOUT,
      max: 1,
    });

    collector?.on('collect', async (i: ButtonInteraction) => {
      if (!i.inCachedGuild()) return;

      if (i.customId === 'invite_or_name') {
        await i.reply({
          content:
            'Use the invite code/hub name with </connect:1107639810014847049> to join the hub.',
          flags: ['Ephemeral'],
        });
      }
      else if (i.customId === 'official') {
        await this.handleChannelSelection(i, interaction.user.id, 'InterChat Central');
      }
    });
  }

  private async handleChannelSelection(
    interaction: MessageComponentInteraction,
    originalUserId: Snowflake,
    hubName: string,
  ): Promise<SetupResult> {
    const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('selectChannel')
        .setChannelTypes([
          ChannelType.GuildText,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        ])
        .setPlaceholder('Select a text channel for InterChat'),
    );

    const replyMethod = getReplyMethod(interaction);
    await interaction[replyMethod]({
      content:
        'Please select a text channel where InterChat will post messages to and from the hub.',
      components: [channelRow],
      flags: ['Ephemeral'],
    });

    const i = await interaction.channel
      ?.awaitMessageComponent({
        componentType: ComponentType.ChannelSelect,
        time: SetupCommand.BUTTON_TIMEOUT,
      })
      .catch(() => null);

    if (!this.validateChannelSelection(i, originalUserId)) {
      return { success: false };
    }

    return await this.setupChannelConnection(i, hubName);
  }

  private validateChannelSelection(
    interaction: MessageComponentInteraction | null | undefined,
    userId: string,
  ): interaction is ChannelSelectMenuInteraction<'cached'> {
    if (
      !interaction?.inCachedGuild() ||
      interaction.user.id !== userId ||
      interaction.customId !== 'selectChannel'
    ) {
      return false;
    }
    return true;
  }

  private async setupChannelConnection(
    interaction: ChannelSelectMenuInteraction<'cached'>,
    hubName: string,
  ): Promise<SetupResult> {
    const channel = interaction.channels.first() as GuildChannel | undefined;

    if (!channel?.isTextBased() || channel.isThread()) {
      await interaction.update({
        content: 'Selected channel is not a text channel. Setup cancelled.',
        components: [],
      });
      return { success: false };
    }

    try {
      const joinService = new HubJoinService(
        interaction,
        await fetchUserLocale(interaction.user.id),
      );
      return { success: await joinService.joinHub(channel, hubName) };
    }
    catch (error) {
      Logger.error('Error joining hub:', error);
      await interaction.update({
        content: 'Failed to join hub. Please check my permissions and try again.',
        components: [],
      });
      return { success: false };
    }
  }

  private async configureHubSettings(
    ctx: Context,
    interaction: StringSelectMenuInteraction,
    hub: HubManager,
  ): Promise<void> {
    const menu = HubConfigSettingsSubcommand.getSettingsMenu(hub, interaction.client);

    await interaction.reply({
      embeds: [hub.settings.getEmbed(interaction.client)],
      components: [menu],
      flags: ['Ephemeral'],
    });

    const nextButton = this.getNextButton('settings');
    const settingsMessage = await interaction.followUp({
      content: 'Once you have configured the settings, click continue to proceed.',
      components: [nextButton],
      flags: ['Ephemeral'],
    });

    const collector = this.createSettingsCollector(settingsMessage);

    collector?.on('collect', async (i: ButtonInteraction) => {
      await i.deferUpdate();
      if (i.customId === 'continueSetupFrom_settings') {
        i.deleteReply().catch(() => null);
        await this.antiSwearSetup(ctx, i, hub);
      }
    });
  }

  private createSettingsCollector(message: Message) {
    return message?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: SetupCommand.MODAL_TIMEOUT,
    });
  }

  private async antiSwearSetup(
    ctx: Context,
    interaction: ButtonInteraction,
    hub: HubManager,
  ): Promise<void> {
    const antiSwearConfig = await this.prepareAntiSwearConfig(ctx, hub);
    await this.displayAntiSwearSettings(ctx, antiSwearConfig);

    const settingsMessage = await this.createAntiSwearContinueButton(interaction);
    const collector = this.createAntiSwearCollector(ctx, settingsMessage);

    collector?.on('collect', async (i: MessageComponentInteraction) => {
      await i.deferUpdate();
      if (i.customId === 'continueSetupFrom_antiSwear') {
        i.deleteReply().catch(() => null);
        await this.moderatorSetup(ctx, hub);
      }
    });
  }

  private async prepareAntiSwearConfig(ctx: Context, hub: HubManager) {
    const locale = await ctx.getLocale();
    const antiSwearRules = await hub.fetchAntiSwearRules();
    const components = HubConfigAntiSwearSubcommand.buildComponents(antiSwearRules, hub.id, locale);

    return { antiSwearRules, components };
  }

  private async displayAntiSwearSettings(
    ctx: Context,
    config: {
      antiSwearRules: BlockWord[];
      components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
    },
  ) {
    if (!config.antiSwearRules.length) {
      await ctx.replyEmbed('hub.blockwords.noRules', {
        t: { emoji: ctx.getEmoji('slash_icon') },
        flags: ['Ephemeral'],
        components: config.components,
      });
    }
  }

  private async createAntiSwearContinueButton(interaction: ButtonInteraction) {
    const nextButton = this.getNextButton('antiSwear');

    return await interaction.followUp({
      content: 'Once you have configured the anti-swear rule, click continue to proceed.',
      components: [nextButton],
      flags: ['Ephemeral'],
    });
  }

  private createAntiSwearCollector(ctx: Context, message: Message) {
    return message?.createMessageComponentCollector({
      filter: (i: MessageComponentInteraction) => i.user.id === ctx.user.id,
      time: SetupCommand.MODAL_TIMEOUT,
    });
  }

  private async moderatorSetup(ctx: Context, hub: HubManager): Promise<void> {
    const modRow = this.createModeratorSelectMenu();

    await ctx.reply({
      content: 'Please select the users you want to assign as hub moderators:',
      components: [modRow],
      flags: ['Ephemeral'],
    });

    const modCollector = this.createModeratorCollector(ctx);

    modCollector?.on('collect', async (i: UserSelectMenuInteraction) => {
      if (i.users.some((u) => u.bot || u.system)) {
        await i.reply({
          content: 'Bots cannot be assigned as moderators. Please try again.',
          components: [],
          flags: ['Ephemeral'],
        });
        return;
      }

      await this.assignModerators(i, hub);
      await this.loggingSetup(ctx, hub);
    });
  }

  private createModeratorSelectMenu() {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('selectModerators')
        .setPlaceholder('Select hub moderators')
        .setMinValues(1)
        .setMaxValues(5),
    );
  }

  private createModeratorCollector(ctx: Context) {
    return ctx.channel?.createMessageComponentCollector({
      componentType: ComponentType.UserSelect,
      filter: (i: UserSelectMenuInteraction) => i.user.id === ctx.user.id,
      time: SetupCommand.BUTTON_TIMEOUT,
      max: 2,
    });
  }

  private async assignModerators(
    interaction: UserSelectMenuInteraction,
    hub: HubManager,
  ): Promise<void> {
    const moderators = interaction.values;
    moderators.forEach((id) => hub.moderators.add(id, Role.MANAGER));

    await interaction.update({
      content: `Assigned moderators: ${moderators.map((id) => `<@${id}>`).join(', ')}`,
      components: [],
    });
  }

  private async loggingSetup(ctx: Context, hub: HubManager): Promise<void> {
    const loggingRow = this.createLoggingChannelMenu();

    await ctx.reply({
      content: 'Please select a text channel to log moderation actions:',
      components: [loggingRow],
      flags: ['Ephemeral'],
    });

    const logCollector = this.createLoggingCollector(ctx);

    logCollector?.on('collect', async (i) => {
      await this.configureLoggingChannel(i, hub);
      const joinStatus = await this.handleChannelSelection(i, ctx.user.id, hub.data.name);
      if (joinStatus.success) await this.finalizeSetup(ctx);
    });
  }

  private createLoggingChannelMenu() {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('selectLoggingChannel')
        .setPlaceholder('Select a text channel for moderation logs')
        .setChannelTypes([
          ChannelType.GuildText,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        ]),
    );
  }

  private createLoggingCollector(ctx: Context) {
    return ctx.channel?.createMessageComponentCollector({
      componentType: ComponentType.ChannelSelect,
      filter: (i) => i.user.id === ctx.user.id && i.customId === 'selectLoggingChannel',
      time: SetupCommand.BUTTON_TIMEOUT,
      max: 1,
    });
  }

  private async configureLoggingChannel(
    interaction: ChannelSelectMenuInteraction,
    hub: HubManager,
  ): Promise<void> {
    const channelId = interaction.values[0];
    const logconfig = await hub.fetchLogConfig();
    await logconfig.setLogChannel('modLogs', channelId);

    await interaction.update({
      content: `Logging channel set to <#${channelId}>.`,
      components: [],
    });
  }

  private async finalizeSetup(ctx: Context): Promise<void> {
    await ctx.reply({
      content:
        'InterChat setup complete! Please send a test message to verify everything works correctly.',
      flags: ['Ephemeral'],
    });
  }

  private getNextButton(
    action: 'logging' | 'settings' | 'antiSwear',
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`continueSetupFrom_${action}`)
        .setLabel('Continue')
        .setStyle(ButtonStyle.Primary),
    );
  }
}
