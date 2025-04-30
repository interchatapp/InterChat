import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ContainerBuilder,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type AutocompleteInteraction,
  type MessageActionRowComponentBuilder,
  type RoleSelectMenuInteraction,
  type AnySelectMenuInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type SelectMenuComponentOptionData,
} from 'discord.js';
import { HubService } from '#src/services/HubService.js';
import type HubManager from '#src/managers/HubManager.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { CustomID } from '#src/utils/CustomID.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { fetchUserLocale, getReplyMethod, toTitleCase } from '#src/utils/Utils.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { stripIndents } from 'common-tags';
import HubLogManager, {
  type LogConfigTypes,
  type RoleIdLogConfigs,
} from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';

const CUSTOM_ID_PREFIX = 'hubConfig' as const;
const ALLOWED_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildAnnouncement,
] as const;

interface LogTypeOption extends SelectMenuComponentOptionData {
  value: LogConfigTypes;
}

export default class HubConfigLoggingSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'logging',
      description: '🔎 Edit channel & role configuration for hub logs.',
      types: { slash: true, prefix: true },
      options: [hubOption],
    });
  }

  public async execute(ctx: Context): Promise<void> {
    const hub = await this.getHubForUser(ctx);
    if (!hub) {
      await ctx.replyEmbed('hub.notFound', { t: { emoji: ctx.getEmoji('slash') } });
      return;
    }

    const container = await this.buildLoggingContainer(
      hub,
      ctx.user.id,
      ctx.client,
      await ctx.getLocale(),
    );

    await ctx.reply({
      components: [container],
      flags: ['IsComponentsV2'],
    });
  }

  public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsRefresh')
  async handleRefreshButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const {
      args: [userId, hubId],
    } = CustomID.parseCustomId(interaction.customId);
    const hub = await this.hubService.fetchHub({ id: hubId });

    if (!hub || interaction.user.id !== userId) return;

    const container = await this.buildLoggingContainer(
      hub,
      userId,
      interaction.client,
      await fetchUserLocale(userId),
    );

    await interaction.editReply({
      components: [container],
      flags: ['IsComponentsV2'],
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsSelect')
  async handleSelectLogs(interaction: ButtonInteraction): Promise<void> {
    const {
      args: [userId, hubId, type],
    } = CustomID.parseCustomId(interaction.customId);

    const hub = await this.hubService.fetchHub({ id: hubId });
    if (!hub || !(await runHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
      return;
    }

    const logConfig = await hub.fetchLogConfig();
    const container = this.buildLogTypeContainer(
      userId,
      hubId,
      type as LogConfigTypes,
      logConfig,
      interaction.client,
    );

    await interaction.update({
      components: [container],
      flags: ['IsComponentsV2'],
    });
  }

  private createLogConfigEmbed(type: LogConfigTypes, logConfig: HubLogManager): InfoEmbed {
    const roleDesc = logConfig.logsWithRoleId.includes(type)
      ? '- `Role` - The role that will be pinged when logs are sent.'
      : '';

    return new InfoEmbed()
      .setTitle(`Configuring \`${type}\` logs`)
      .setDescription(
        stripIndents`
        You are now configuring the **${toTitleCase(type)}** logs for this hub.
        Use the menu below to set the channel and/or role for this log type.

        - \`Channel\` - The channel where logs will be sent.
        ${roleDesc}
      `,
      )
      .setTimestamp();
  }

  private createLogConfigComponents(
    userId: string,
    hubId: string,
    type: LogConfigTypes,
    logConfig: HubLogManager,
    client: Client,
  ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
      this.createChannelSelectRow(userId, logConfig, type),
    ];

    if (logConfig.logsWithRoleId.includes(type)) {
      components.push(this.createRoleSelectRow(userId, logConfig, type as RoleIdLogConfigs));
    }

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.getRefreshButton(userId, hubId).setEmoji(getEmoji('back', client)),
      ),
    );

    return components;
  }

  private createChannelSelectRow(
    userId: string,
    logConfig: HubLogManager,
    type: LogConfigTypes,
  ): ActionRowBuilder<ChannelSelectMenuBuilder> {
    const channelIdField = `${type}ChannelId`;
    const channelId = logConfig.config[channelIdField as keyof typeof logConfig.config];
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(
          new CustomID('hubConfig:logsChannel').setArgs(userId, logConfig.hubId, type).toString(),
        )
        .setPlaceholder('Select a channel to send logs to')
        .addChannelTypes(...ALLOWED_CHANNEL_TYPES)
        .setDefaultChannels(channelId ? [channelId as string] : [])
        .setMinValues(0),
    );
  }

  private createRoleSelectRow(
    userId: string,
    logConfig: HubLogManager,
    type: RoleIdLogConfigs,
  ): ActionRowBuilder<RoleSelectMenuBuilder> {
    const roleIdField = `${type}RoleId`;
    const existingRole = logConfig.config[roleIdField as keyof typeof logConfig.config];

    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(
          new CustomID('hubConfig:logsRole').setArgs(userId, logConfig.hubId, type).toString(),
        )
        .setPlaceholder('Select a role to ping when logs are sent')
        .setDefaultRoles(existingRole ? [existingRole as string] : [])
        .setMinValues(0),
    );
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsChannel')
  async handleChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
    await interaction.deferUpdate();

    const { args } = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = args;
    const selectedType = args[2] as LogConfigTypes;

    if (interaction.user.id !== userId) return;

    const [channelId] = interaction.values;
    const locale = await fetchUserLocale(interaction.user.id);

    const logManager = await HubLogManager.create(hubId);

    if (!channelId) {
      await logManager.resetLog(selectedType);
      await this.sendSuccessResponse(interaction, 'reset', locale, selectedType);

      // Update the UI with components v2
      const container = this.buildLogTypeContainer(
        userId,
        hubId,
        selectedType,
        logManager,
        interaction.client,
      );

      await interaction.editReply({
        components: [container],
        flags: ['IsComponentsV2'],
      });
      return;
    }

    await logManager.setLogChannel(selectedType, channelId);
    await this.sendSuccessResponse(interaction, 'channelSuccess', locale, selectedType, channelId);

    // Update the UI with components v2
    const container = this.buildLogTypeContainer(
      userId,
      hubId,
      selectedType,
      logManager,
      interaction.client,
    );

    await interaction.editReply({
      components: [container],
      flags: ['IsComponentsV2'],
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsRole')
  async handleRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
    await interaction.deferUpdate();

    const { args } = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = args;
    const selectedType = args[2] as RoleIdLogConfigs;

    if (interaction.user.id !== userId) return;

    const logConfig = await HubLogManager.create(hubId);
    const locale = await fetchUserLocale(interaction.user.id);

    const [roleId] = interaction.values;

    if (!roleId) {
      await logConfig.removeRoleId(selectedType);
      await this.sendSuccessResponse(interaction, 'roleRemoved', locale, selectedType);

      // Update the UI with components v2
      const container = this.buildLogTypeContainer(
        userId,
        hubId,
        selectedType,
        logConfig,
        interaction.client,
      );

      await interaction.editReply({
        components: [container],
        flags: ['IsComponentsV2'],
      });
      return;
    }

    await logConfig.setRoleId(selectedType, roleId);
    await this.sendSuccessResponse(
      interaction,
      'roleSuccess',
      locale,
      selectedType,
      undefined,
      roleId,
    );

    // Update the UI with components v2
    const container = this.buildLogTypeContainer(
      userId,
      hubId,
      selectedType,
      logConfig,
      interaction.client,
    );

    await interaction.editReply({
      components: [container],
      flags: ['IsComponentsV2'],
    });
  }

  private async sendSuccessResponse(
    interaction: AnySelectMenuInteraction,
    type: 'reset' | 'channelSuccess' | 'roleRemoved' | 'roleSuccess',
    locale: supportedLocaleCodes,
    logType: LogConfigTypes,
    channelId?: string,
    roleId?: string,
  ): Promise<void> {
    const emoji = getEmoji('tick_icon', interaction.client);
    const content = t(`hub.manage.logs.${type}`, locale, {
      emoji,
      type: `\`${logType}\``,
      channel: channelId ? `<#${channelId}>` : '',
      role: roleId ? `<@&${roleId}>` : '',
    });

    const replyMethod = getReplyMethod(interaction);
    await interaction[replyMethod]({ content, flags: ['Ephemeral'] });
  }

  private getLogTypeOptions(locale: supportedLocaleCodes): LogTypeOption[] {
    return [
      {
        label: t('hub.manage.logs.reports.label', locale),
        value: 'reports',
        description: t('hub.manage.logs.reports.description', locale),
        emoji: '📢',
      },
      {
        label: t('hub.manage.logs.modLogs.label', locale),
        value: 'modLogs',
        description: t('hub.manage.logs.modLogs.description', locale),
        emoji: '👮',
      },
      {
        label: t('hub.manage.logs.networkAlerts.label', locale),
        value: 'networkAlerts',
        description: t('hub.manage.logs.networkAlerts.description', locale),
        emoji: '🚨',
      },
      {
        label: t('hub.manage.logs.joinLeaves.label', locale),
        value: 'joinLeaves',
        description: t('hub.manage.logs.joinLeaves.description', locale),
        emoji: '👋',
      },
      {
        label: t('hub.manage.logs.appeals.label', locale),
        value: 'appeals',
        description: t('hub.manage.logs.appeals.description', locale),
        emoji: '🔓',
      },
    ];
  }

  private async buildLoggingContainer(
    hub: HubManager,
    userId: string,
    client: Client,
    locale: supportedLocaleCodes,
  ): Promise<ContainerBuilder> {
    const hubLogManager = await hub.fetchLogConfig();
    const container = new ContainerBuilder();

    // header
    const headerText = new TextDisplayBuilder().setContent(
      stripIndents`## ${getEmoji('wand_icon', client)} Hub Logging Configuration
      Configure where different types of logs are sent in your server.`,
    );
    container.addTextDisplayComponents(headerText);

    // Add separator
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Large),
    );

    // Add current log settings
    const channelStr = t('hub.manage.logs.config.fields.channel', locale);
    const roleStr = t('hub.manage.logs.config.fields.role', locale);
    const x_icon = getEmoji('x_icon', client);

    // Create a section for each log type
    for (const type of hubLogManager.logTypes) {
      const channelIdField = `${type}ChannelId` as const;
      const roleIdField = `${type}RoleId` as const;

      const channelId = hubLogManager.config[channelIdField];
      const roleId = hubLogManager.logsWithRoleId.includes(type)
        ? hubLogManager.config[roleIdField]
        : null;

      const channelStatus = channelId ? `<#${channelId}>` : x_icon;
      // eslint-disable-next-line no-nested-ternary
      const roleStatus = roleId
        ? `<@&${roleId}>`
        : hubLogManager.logsWithRoleId.includes(type)
          ? x_icon
          : 'N/A';

      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${toTitleCase(type)}\n${t(`hub.manage.logs.${type}.description`, locale)}\n**${channelStr}:** ${channelStatus}\n**${roleStr}:** ${roleStatus}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(
              new CustomID()
                .setIdentifier(CUSTOM_ID_PREFIX, 'logsSelect')
                .setArgs(userId, hub.id, type) // Add type to the args to make each custom ID unique
                .toString(),
            )
            .setLabel('Configure')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚙️'),
        );

      container.addSectionComponents(section);
    }

    // Add refresh button
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(this.getRefreshButton(userId, hub.id)),
    );

    return container;
  }

  private buildLogTypeContainer(
    userId: string,
    hubId: string,
    type: LogConfigTypes,
    logConfig: HubLogManager,
    client: Client,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      stripIndents`
      ## Configuring \`${toTitleCase(type)}\` Logs
      Use the options below to set up where these logs will be sent.`,
    );
    container.addTextDisplayComponents(headerText);

    // Add description
    const descriptionText = new TextDisplayBuilder().setContent(
      stripIndents`
      ### ${t(`hub.manage.logs.${type}.label`, 'en')}
      ${t(`hub.manage.logs.${type}.description`, 'en')}
      `,
    );
    container.addTextDisplayComponents(descriptionText);

    // Add separator
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Large),
    );

    // Add channel selection
    const channelSelectText = new TextDisplayBuilder().setContent(
      `### Channel Selection\nSelect a channel where ${toTitleCase(type)} logs will be sent:`,
    );
    container.addTextDisplayComponents(channelSelectText);

    // Add channel select menu
    container.addActionRowComponents(this.createChannelSelectRow(userId, logConfig, type));

    // Add role selection if applicable
    if (logConfig.logsWithRoleId.includes(type)) {
      const roleSelectText = new TextDisplayBuilder().setContent(
        `### Role Mention\nSelect a role to be pinged when ${toTitleCase(type)} logs are sent:`,
      );
      container.addTextDisplayComponents(roleSelectText);

      // Add role select menu
      container.addActionRowComponents(
        this.createRoleSelectRow(userId, logConfig, type as RoleIdLogConfigs),
      );
    }

    // Add back button
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier(CUSTOM_ID_PREFIX, 'logsRefresh')
              .setArgs(userId, hubId)
              .toString(),
          )
          .setLabel('Back to Overview')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(getEmoji('back', client)),
      ),
    );

    return container;
  }

  private async getHubForUser(ctx: Context): Promise<HubManager | null> {
    const hubName = ctx.options.getString('hub', true);
    const [hub] = await this.hubService.findHubsByName(hubName, { insensitive: true });

    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return null;
    }

    return hub;
  }

  private buildComponents(
    hubId: string,
    userId: string,
    locale: supportedLocaleCodes,
  ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const configSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier(CUSTOM_ID_PREFIX, 'logsSelect')
            .setArgs(userId, hubId)
            .toString(),
        )
        .setPlaceholder('Select a log type to configure')
        .addOptions(this.getLogTypeOptions(locale)),
    );

    const refreshButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      this.getRefreshButton(userId, hubId),
    );

    return [configSelectRow, refreshButtonRow];
  }

  private getRefreshButton(userId: string, hubId: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(CUSTOM_ID_PREFIX, 'logsRefresh')
          .setArgs(userId, hubId)
          .toString(),
      )
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary);
  }
}
