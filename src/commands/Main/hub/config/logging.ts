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
  InteractionResponse,
  SelectMenuComponentOptionData,
} from 'discord.js';
import { HubService } from '#src/services/HubService.js';
import type HubManager from '#src/managers/HubManager.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { CustomID } from '#src/utils/CustomID.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { fetchUserLocale, getReplyMethod, toTitleCase } from '#src/utils/Utils.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { stripIndents } from 'common-tags';
import HubLogManager, {
  type LogConfigTypes,
  type RoleIdLogConfigs,
} from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';

const CUSTOM_ID_PREFIX = 'hubConfig' as const;
const COLLECTOR_IDLE_TIME = 60000;
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
    if (!hub) return;

    const embed = await this.getEmbed(ctx.client, hub);
    const components = this.buildComponents(hub.id, ctx.user.id, await ctx.getLocale());

    await ctx.reply({ embeds: [embed], components });
  }

  public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'logsRefresh')
  private async handleRefreshButton(interaction: ButtonInteraction): Promise<void> {
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
  private async handleSelectLogs(interaction: StringSelectMenuInteraction): Promise<void> {
    const {
      args: [userId, hubId],
    } = CustomID.parseCustomId(interaction.customId);
    const type = interaction.values[0] as LogConfigTypes;

    const hub = await this.hubService.fetchHub({ id: hubId });
    if (!hub || !(await executeHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
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

    const reply = await interaction.update({ embeds: [embed], components });
    this.setupLogConfigCollector(reply, userId, type, logConfig);
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
      this.createChannelSelectRow(logConfig, type),
    ];

    if (logConfig.logsWithRoleId.includes(type)) {
      components.push(this.createRoleSelectRow(logConfig, type as RoleIdLogConfigs));
    }

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.getRefreshButton(userId, hubId).setEmoji(getEmoji('back', client)),
      ),
    );

    return components;
  }

  private createChannelSelectRow(
    logConfig: HubLogManager,
    type: LogConfigTypes,
  ): ActionRowBuilder<ChannelSelectMenuBuilder> {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('hubConfig:logsChannel')
        .setPlaceholder('Select a channel to send logs to')
        .addChannelTypes(...ALLOWED_CHANNEL_TYPES)
        .setDefaultChannels(
          logConfig.config[type]?.channelId ? [logConfig.config[type].channelId] : [],
        )
        .setMinValues(0),
    );
  }

  private createRoleSelectRow(
    logConfig: HubLogManager,
    type: RoleIdLogConfigs,
  ): ActionRowBuilder<RoleSelectMenuBuilder> {
    const existingRole = logConfig.config[type]?.roleId;

    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('hubConfig:logsRole')
        .setPlaceholder('Select a role to ping when logs are sent')
        .setDefaultRoles(existingRole ? [existingRole] : [])
        .setMinValues(0),
    );
  }

  private setupLogConfigCollector(
    reply: InteractionResponse,
    userId: string,
    type: LogConfigTypes,
    logConfig: HubLogManager,
  ): void {
    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === userId && i.customId.startsWith('hubConfig:logs'),
      idle: COLLECTOR_IDLE_TIME,
    });

    collector.on('collect', async (interaction: AnySelectMenuInteraction) => {
      const locale = await fetchUserLocale(interaction.user.id);

      if (interaction.customId === 'hubConfig:logsChannel' && interaction.isChannelSelectMenu()) {
        await this.handleChannelSelect(interaction, type, logConfig, locale);
      }
      else if (interaction.customId === 'hubConfig:logsRole' && interaction.isRoleSelectMenu()) {
        await this.handleRoleSelect(interaction, type as RoleIdLogConfigs, logConfig, locale);
      }
    });
  }

  private async handleChannelSelect(
    interaction: ChannelSelectMenuInteraction,
    selectedType: LogConfigTypes,
    logManager: HubLogManager,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    await interaction.deferUpdate();

    const [channelId] = interaction.values;

    if (!channelId) {
      await logManager.resetLog(selectedType);
      await this.sendSuccessResponse(interaction, 'reset', locale, selectedType);
      return;
    }

    await logManager.setLogChannel(selectedType, channelId);
    await this.sendSuccessResponse(interaction, 'channelSuccess', locale, selectedType, channelId);
  }

  private async handleRoleSelect(
    interaction: RoleSelectMenuInteraction,
    selectedType: RoleIdLogConfigs,
    logConfig: HubLogManager,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    await interaction.deferUpdate();

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
    const hubs = await this.hubService.findHubsByName(hubName, {
      insensitive: true,
      ownerId: ctx.user.id,
    });

    return hubs[0] ?? null;
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
