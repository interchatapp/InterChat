import Constants, { emojis } from '#main/config/Constants.js';
import BaseCommand from '#main/core/BaseCommand.js';
import { RegisterInteractionHandler } from '#main/decorators/Interaction.js';
import HubLogManager from '#main/managers/HubLogManager.js';
import {
  findOriginalMessage,
  getOriginalMessage,
  OriginalMessage,
} from '#main/utils/network/messageUtils.js';
import type { RemoveMethods } from '#types/index.d.ts';
import { greyOutButton, greyOutButtons } from '#utils/ComponentUtils.js';
import { getHubConnections } from '#utils/ConnectedListUtils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { fetchHub, isStaffOrHubMod } from '#utils/hub/utils.js';
import { sendHubReport } from '#utils/HubLogger/Report.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import modActionsPanel from '#utils/moderation/modActions/modActionsPanel.js';
import type { connectedList, Hub } from '@prisma/client';
import {
  ActionRow,
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonComponent,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
  codeBlock,
  ComponentType,
  EmbedBuilder,
  Guild,
  MessageContextMenuCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
  TextInputBuilder,
  TextInputStyle,
  time,
  User,
} from 'discord.js';

type LocaleInfo = { locale: supportedLocaleCodes };
type AuthorInfo = { author: User };
type ServerInfo = { server: RemoveMethods<Guild> | undefined };
type HubInfo = { hub: Hub | null };
type MsgInfo = { messageId: string };

type UserInfoOpts = LocaleInfo & AuthorInfo;
type MsgInfoOpts = AuthorInfo & ServerInfo & LocaleInfo & HubInfo & MsgInfo;
type ReportOpts = LocaleInfo & HubInfo & MsgInfo;
type ModActionsOpts = { originalMsg: OriginalMessage };
type ServerInfoOpts = LocaleInfo & ServerInfo & { connection: connectedList | undefined };

export default class MessageInfo extends BaseCommand {
  readonly data: RESTPostAPIApplicationCommandsJSONBody = {
    type: ApplicationCommandType.Message,
    name: 'Message Info/Report',
    dm_permission: false,
  };

  async execute(interaction: MessageContextMenuCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.targetMessage;

    const { locale, originalMsg, hub } = await this.getMessageInfo(interaction);

    if (!hub || !originalMsg) {
      await interaction.followUp({
        content: t('errors.unknownNetworkMessage', locale, { emoji: emojis.no }),
        ephemeral: true,
      });
      return;
    }

    const author = await interaction.client.users.fetch(originalMsg.authorId);
    const server = await interaction.client.fetchGuild(originalMsg.guildId);

    const embed = new EmbedBuilder()
      .setDescription(`### ${emojis.info} Message Info`)
      .addFields([
        { name: 'Sender', value: codeBlock(author.username), inline: true },
        { name: 'From Server', value: codeBlock(`${server?.name}`), inline: true },
        { name: 'Which Hub?', value: codeBlock(hub.name), inline: true },
        { name: 'Message ID', value: codeBlock(originalMsg.messageId), inline: true },
        { name: 'Sent At', value: time(new Date(originalMsg.timestamp), 't'), inline: true },
      ])
      .setThumbnail(author.displayAvatarURL())
      .setColor(Constants.Colors.invisible);

    const connection = (await getHubConnections(hub.id))?.find(
      (c) => c.connected && c.serverId === originalMsg.guildId,
    );
    const components = this.buildButtons(locale, {
      buildModActions: isStaffOrHubMod(interaction.user.id, hub),
      inviteButtonUrl: connection?.invite,
    });

    const reply = await interaction.followUp({
      embeds: [embed],
      components,
      ephemeral: true,
    });

    const collector = reply.createMessageComponentCollector({
      idle: 60_000,
      componentType: ComponentType.Button,
    });

    collector.on('collect', (i) => {
      const customId = CustomID.parseCustomId(i.customId);
      // component builders taken from the original message
      const newComponents = [
        ActionRowBuilder.from<ButtonBuilder>(i.message.components[0] as ActionRow<ButtonComponent>),
      ];

      if (i.message.components[1]) {
        newComponents.push(
          ActionRowBuilder.from<ButtonBuilder>(
            i.message.components[1] as ActionRow<ButtonComponent>,
          ),
        );
      }

      // button responses
      switch (customId.suffix) {
        case 'serverInfo':
          this.handleServerInfoButton(i, newComponents, { server, locale, connection });
          break;

        case 'userInfo':
          this.handleUserInfoButton(i, newComponents, { author, locale });
          break;

        case 'msgInfo':
          this.handleMsgInfoButton(i, newComponents, {
            author,
            server,
            locale,
            hub,
            messageId: target.id,
          });
          break;

        case 'report':
          this.handleReportButton(i, { hub, locale, messageId: target.id });
          break;

        case 'modActions':
          this.handleModActionsButton(i, { originalMsg });
          break;

        default:
          break;
      }
    });

    collector.on('end', async (i) => {
      greyOutButtons(components);
      await i.first()?.editReply({ components });
    });
  }

  @RegisterInteractionHandler('msgInfoModal')
  override async handleModals(interaction: ModalSubmitInteraction<CacheType>) {
    const { originalMsg, messageId, locale } = await this.getModalMessageInfo(interaction);

    if (
      !originalMsg?.hubId ||
      !(await HubLogManager.create(originalMsg?.hubId)).config.reports?.channelId
    ) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: emojis.no }),
      );

      await interaction.reply({ embeds: [notEnabledEmbed], ephemeral: true });
      return;
    }

    const { authorId, guildId } = originalMsg;

    const reason = interaction.fields.getTextInputValue('reason');
    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);
    const content = message?.content || message?.embeds[0].description || undefined;
    const attachmentUrl =
      content?.match(Constants.Regex.StaticImageUrl)?.at(0) ?? message?.embeds[0]?.image?.url;

    await sendHubReport(originalMsg.hubId, interaction.client, {
      userId: authorId,
      serverId: guildId,
      reason,
      reportedBy: interaction.user,
      evidence: {
        content,
        attachmentUrl,
        messageId,
      },
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: emojis.yes }),
    );

    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
  }

  private async handleServerInfoButton(
    interaction: ButtonInteraction,
    components: ActionRowBuilder<ButtonBuilder>[],
    { server, locale, connection }: ServerInfoOpts,
  ) {
    if (!server) {
      await interaction.update({
        content: t('errors.unknownServer', locale, { emoji: emojis.no }),
        embeds: [],
        components: [],
      });
      return;
    }

    const owner = await interaction.client.users.fetch(server.ownerId);
    const createdAt = Math.round(server.createdTimestamp / 1000);
    const ownerName = `${owner.username}#${
      owner.discriminator !== '0' ? `#${owner.discriminator}` : ''
    }`;

    const iconUrl = server.icon
      ? `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png`
      : null;
    const bannerUrL = server.icon
      ? `https://cdn.discordapp.com/icons/${server.id}/${server.banner}.png`
      : null;
    const inviteString = connection?.invite ? `${connection.invite}` : 'Not Set.';

    const serverEmbed = new EmbedBuilder()
      .setDescription(`### ${emojis.info} ${server.name}`)
      .addFields([
        { name: 'Owner', value: codeBlock(ownerName), inline: true },
        { name: 'Member Count', value: codeBlock(String(server.memberCount)), inline: true },
        { name: 'Server ID', value: codeBlock(server.id), inline: true },
        { name: 'Invite', value: inviteString, inline: true },
        { name: 'Created At', value: time(createdAt, 'R'), inline: true },
      ])
      .setThumbnail(iconUrl)
      .setImage(bannerUrL)
      .setColor(Constants.Colors.invisible);

    // disable the server info button
    greyOutButton(components[0], 1);

    await interaction.update({ embeds: [serverEmbed], components, files: [] });
  }

  private async handleUserInfoButton(
    interaction: ButtonInteraction,
    components: ActionRowBuilder<ButtonBuilder>[],
    { author }: UserInfoOpts,
  ) {
    await interaction.deferUpdate();
    const createdAt = Math.round(author.createdTimestamp / 1000);
    const hubsOwned = await db.hub.count({ where: { ownerId: author.id } });
    const displayName = author.globalName ?? 'Not Set.';

    const userEmbed = new EmbedBuilder()
      .setDescription(`### ${emojis.info} ${author.username}`)
      .addFields([
        { name: 'Display Name', value: codeBlock(displayName), inline: true },
        { name: 'User ID', value: codeBlock(author.id), inline: true },
        { name: 'Hubs Owned', value: codeBlock(`${hubsOwned}`), inline: true },
        {
          name: 'Created At',
          value: `${time(createdAt, 'd')} (${time(createdAt, 'R')})`,
          inline: true,
        },
      ])
      .setThumbnail(author.displayAvatarURL())
      .setImage(author.bannerURL() ?? null)
      .setColor(Constants.Colors.invisible);

    // disable the user info button
    greyOutButton(components[0], 2);

    await interaction.editReply({ embeds: [userEmbed], components });
  }

  private async handleMsgInfoButton(
    interaction: ButtonInteraction,
    components: ActionRowBuilder<ButtonBuilder>[],
    { author, server, locale, hub, messageId }: MsgInfoOpts,
  ) {
    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);

    if (!message || !hub) {
      await interaction.update({
        content: t('errors.unknownNetworkMessage', locale, { emoji: emojis.no }),
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setDescription(`### ${emojis.info} Message Info`)
      .addFields([
        { name: 'Sender', value: codeBlock(author.username), inline: true },
        { name: 'From Server', value: codeBlock(`${server?.name}`), inline: true },
        { name: 'Which Hub?', value: codeBlock(hub.name), inline: true },
        { name: 'Message ID', value: codeBlock(messageId), inline: true },
        { name: 'Sent At', value: time(message.createdAt, 't'), inline: true },
      ])
      .setThumbnail(author.displayAvatarURL())
      .setColor(Constants.Colors.invisible);

    greyOutButton(components[0], 0);

    await interaction.update({ embeds: [embed], components, files: [] });
  }

  private async handleModActionsButton(
    interaction: ButtonInteraction,
    { originalMsg }: ModActionsOpts,
  ) {
    const hub = await fetchHub(originalMsg.hubId);
    if (!hub || !isStaffOrHubMod(interaction.user.id, hub)) {
      await interaction.reply({
        content: t('hub.notFound_mod', 'en', { emoji: emojis.no }),
        ephemeral: true,
      });
      return;
    }

    const { buttons, embed } = await modActionsPanel.buildMessage(interaction, originalMsg);
    await interaction.reply({ embeds: [embed], components: buttons, ephemeral: true });
  }

  private async handleReportButton(
    interaction: ButtonInteraction,
    { hub, locale, messageId }: ReportOpts,
  ) {
    if (!hub || !(await HubLogManager.create(hub.id)).config.reports?.channelId) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: emojis.no }),
      );

      await interaction.reply({ embeds: [notEnabledEmbed], ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(new CustomID('msgInfoModal:report', [messageId]).toString())
      .setTitle('Report Message')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for report')
            .setPlaceholder('Spamming text, sending NSFW content etc.')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  // utils
  private async fetchHub(hubId: string | undefined) {
    return hubId ? await fetchHub(hubId) : null;
  }

  private async getMessageInfo(interaction: MessageContextMenuCommandInteraction) {
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);
    const target = interaction.targetMessage;
    const originalMsg =
      (await getOriginalMessage(target.id)) ?? (await findOriginalMessage(target.id));
    console.log(originalMsg);
    const hub = await this.fetchHub(originalMsg?.hubId);

    return { target, locale, originalMsg, hub };
  }

  private async getModalMessageInfo(interaction: ModalSubmitInteraction<CacheType>) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [messageId] = customId.args;
    const originalMsg =
      (await getOriginalMessage(messageId)) ?? (await findOriginalMessage(messageId));

    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    return { originalMsg, locale, messageId };
  }

  private buildButtons(
    locale: supportedLocaleCodes = 'en',
    opts?: { buildModActions?: boolean; inviteButtonUrl?: string | null },
  ) {
    const extras = [
      new ButtonBuilder()
        .setLabel(t('msgInfo.buttons.report', locale))
        .setStyle(ButtonStyle.Danger)
        .setCustomId(new CustomID().setIdentifier('msgInfo', 'report').toString()),
    ];

    if (opts?.buildModActions) {
      extras.push(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🛠️')
          .setLabel('Mod Actions')
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'modActions').toString()),
      );
    }
    if (opts?.inviteButtonUrl) {
      extras.push(
        new ButtonBuilder()
          .setLabel('Join Server')
          .setStyle(ButtonStyle.Link)
          .setURL(opts.inviteButtonUrl)
          .setDisabled(false),
      );
    }

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.message', locale))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'msgInfo').toString()),
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.server', locale))
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'serverInfo').toString()),
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.user', locale))
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'userInfo').toString()),
      ),
      new ActionRowBuilder<ButtonBuilder>({ components: extras }),
    ];
  }
}
