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
  RoleSelectMenuBuilder,
  type ButtonInteraction,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
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

    const embed = await this.getEmbed(ctx.client, hub);
    const components = this.buildComponents(hub.id, ctx.user.id, await ctx.getLocale());

    await ctx.reply({ embeds: [embed], components });
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

    const embed = await this.getEmbed(interaction.client, hub);
    const components = this.buildComponents(hubId, userId, await fetchUserLocale(userId));
    await interaction.editReply({ embeds: [embed], components });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsSelect')
  async handleSelectLogs(interaction: StringSelectMenuInteraction): Promise<void> {
    const {
      args: [userId, hubId],
    } = CustomID.parseCustomId(interaction.customId);
    const type = interaction.values[0] as LogConfigTypes;

    const hub = await this.hubService.fetchHub({ id: hubId });
    if (!hub || !(await runHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
      return;
    }

    const logConfig = await hub.fetchLogConfig();
    const embed = this.createLogConfigEmbed(type, logConfig);
    const components = this.createLogConfigComponents(
      userId,
      hubId,
      type,
      logConfig,
      interaction.client,
    );

    await interaction.update({ embeds: [embed], components });
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
        .setDefaultChannels(
          channelId ? [channelId as string] : [],
        )
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
      return;
    }

    await logManager.setLogChannel(selectedType, channelId);
    await this.sendSuccessResponse(interaction, 'channelSuccess', locale, selectedType, channelId);
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

  private async getEmbed(client: Client, hub: HubManager): Promise<InfoEmbed> {
    const hubLogManager = await hub.fetchLogConfig();
    return hubLogManager.getEmbed(client);
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
