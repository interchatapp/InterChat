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
import { modPanelButton } from '#src/interactions/ShowModPanel.js';
import type ConnectionManager from '#src/managers/ConnectionManager.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { buildProfileEmbed } from '#src/utils/ProfileUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import type { RemoveMethods } from '#types/CustomClientProps.d.ts';
import { greyOutButton, greyOutButtons } from '#utils/ComponentUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { sendHubReport } from '#utils/hub/logger/Report.js';
import { isStaffOrHubMod } from '#utils/hub/utils.js';
import {
  type ActionRow,
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonBuilder,
  type ButtonComponent,
  type ButtonInteraction,
  ButtonStyle,
  type CacheType,
  type Client,
  ComponentType,
  type Guild,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type User,
  codeBlock,
  time,
} from 'discord.js';

type LocaleInfo = { locale: supportedLocaleCodes };
type AuthorInfo = { author: User };
type ServerInfo = { server: RemoveMethods<Guild> | undefined };
type HubInfo = { hub: HubManager | null };
type MsgInfo = { messageId: string };

type UserInfoOpts = LocaleInfo & AuthorInfo;
type MsgInfoOpts = AuthorInfo & ServerInfo & LocaleInfo & HubInfo & MsgInfo;
type ReportOpts = LocaleInfo & HubInfo & MsgInfo;
type ServerInfoOpts = LocaleInfo & ServerInfo & { connection: ConnectionManager | undefined };

export default class MessageInfo extends BaseCommand {
  constructor() {
    super({
      name: 'messageinfo',
      description: 'Get information about a message.',
      types: {
        prefix: true,
        slash: true,
        contextMenu: { name: 'Message Info/Report', type: ApplicationCommandType.Message },
      },
      options: [
        {
          name: 'message',
          description: 'The message to get information about.',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const { locale, originalMsg, hub, targetId } = await this.getMessageInfo(ctx);

    if (!hub || !originalMsg || !targetId) {
      await replyWithUnknownMessage(ctx, { edit: true });
      return;
    }

    const author = await ctx.client.users.fetch(originalMsg.authorId);
    const server = await ctx.client.fetchGuild(originalMsg.guildId);

    // Get the profile embed first
    const profileEmbed = await buildProfileEmbed(author, ctx.client);
    if (!profileEmbed) {
      await replyWithUnknownMessage(ctx, { edit: true });
      return;
    }

    const connection = (await hub.connections.fetch())?.find(
      (c) => c.data.connected && c.data.serverId === originalMsg.guildId,
    );
    const components = this.buildButtons(ctx.client, targetId, locale, {
      buildModActions: await isStaffOrHubMod(ctx.user.id, hub),
      inviteButtonUrl: connection?.data.invite,
    });

    const reply = await ctx.editOrReply({ embeds: [profileEmbed], components }, ['Ephemeral']);

    const collector = reply?.createMessageComponentCollector({
      idle: 60_000,
      componentType: ComponentType.Button,
    });

    collector?.on('collect', (i) => {
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
            messageId: targetId,
          });
          break;

        case 'report':
          this.handleReportButton(i, { hub, locale, messageId: targetId });
          break;

        default:
          break;
      }
    });

    collector?.on('end', async (i) => {
      greyOutButtons(components);
      await i.first()?.editReply({ components });
    });
  }

  @RegisterInteractionHandler('msgInfoModal')
  async handleModals(interaction: ModalSubmitInteraction<CacheType>) {
    const { originalMsg, messageId, locale } = await this.getModalMessageInfo(interaction);

    if (
      !originalMsg?.hubId ||
      !(await HubLogManager.create(originalMsg?.hubId)).config.reports?.channelId
    ) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: getEmoji('x_icon', interaction.client) }),
      );

      await interaction.reply({ embeds: [notEnabledEmbed], flags: ['Ephemeral'] });
      return;
    }

    const { authorId, guildId } = originalMsg;

    const reason = interaction.fields.getTextInputValue('reason');
    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);
    const content = originalMsg.content;
    const attachmentUrl =
      content?.match(Constants.Regex.StaticImageUrl)?.at(0) ?? message?.embeds[0]?.image?.url;

    await sendHubReport(originalMsg.hubId, interaction.client, {
      userId: authorId,
      serverId: guildId,
      reason,
      reportedBy: interaction.user,
      evidence: { content, attachmentUrl, messageId },
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: getEmoji('tick_icon', interaction.client) }),
    );

    await interaction.reply({ embeds: [successEmbed], flags: ['Ephemeral'] });
  }

  private async handleServerInfoButton(
    interaction: ButtonInteraction,
    components: ActionRowBuilder<ButtonBuilder>[],
    { server, locale, connection }: ServerInfoOpts,
  ) {
    if (!server) {
      await interaction.update({
        content: t('errors.unknownServer', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        embeds: [],
        components: [],
      });
      return;
    }

    const owner = await interaction.client.users.fetch(server.ownerId);
    const createdAt = Math.round(server.createdTimestamp / 1000);
    const inviteString = connection?.data.invite ?? 'Not Set.';
    const ownerName = `${owner.username}#${
      owner.discriminator !== '0' ? `#${owner.discriminator}` : ''
    }`;
    const iconUrl = server.icon
      ? `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png`
      : null;
    const bannerUrL = server.icon
      ? `https://cdn.discordapp.com/icons/${server.id}/${server.banner}.png`
      : null;

    const serverEmbed = new InfoEmbed()
      .setDescription(`### ${getEmoji('info_icon', interaction.client)} ${server.name}`)
      .addFields([
        { name: 'Owner', value: codeBlock(ownerName), inline: true },
        { name: 'Member Count', value: codeBlock(String(server.memberCount)), inline: true },
        { name: 'Server ID', value: codeBlock(server.id), inline: true },
        { name: 'Invite', value: inviteString, inline: true },
        { name: 'Created At', value: time(createdAt, 'R'), inline: true },
      ])
      .setThumbnail(iconUrl)
      .setImage(bannerUrL)
      .setColor(Constants.Colors.interchat);

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

    const profileEmbed = await buildProfileEmbed(author, interaction.client);
    if (!profileEmbed) {
      await interaction.editReply({
        content: 'Failed to fetch user profile.',
        embeds: [],
        components: [],
      });
      return;
    }

    // disable the user info button
    greyOutButton(components[0], 1);

    await interaction.editReply({
      embeds: [profileEmbed],
      components,
    });
  }

  private async handleMsgInfoButton(
    interaction: ButtonInteraction,
    components: ActionRowBuilder<ButtonBuilder>[],
    { author, server, locale, hub, messageId }: MsgInfoOpts,
  ) {
    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);

    if (!message || !hub) {
      await interaction.update({
        content: t('errors.unknownNetworkMessage', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = new InfoEmbed()
      .setDescription(`### ${getEmoji('info_icon', interaction.client)} Message Info`)
      .addFields([
        { name: 'Sender', value: codeBlock(author.username), inline: true },
        { name: 'From Server', value: codeBlock(`${server?.name}`), inline: true },
        { name: 'Which Hub?', value: codeBlock(hub.data.name), inline: true },
        { name: 'Message ID', value: codeBlock(messageId), inline: true },
        { name: 'Sent At', value: time(message.createdAt, 't'), inline: true },
      ])
      .setThumbnail(author.displayAvatarURL())
      .setColor(Constants.Colors.invisible);

    greyOutButton(components[0], 2);

    await interaction.update({ embeds: [embed], components, files: [] });
  }

  private async handleReportButton(
    interaction: ButtonInteraction,
    { hub, locale, messageId }: ReportOpts,
  ) {
    if (!hub || !(await HubLogManager.create(hub.id)).config.reports?.channelId) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: getEmoji('x_icon', interaction.client) }),
      );

      await interaction.reply({ embeds: [notEnabledEmbed], flags: ['Ephemeral'] });
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
    const hubService = new HubService(db);
    return hubId ? await hubService.fetchHub(hubId) : null;
  }

  private async getMessageInfo(ctx: Context) {
    const locale = (await fetchUserLocale(ctx.user.id)) ?? 'en';
    const targetId = ctx.getTargetMessageId('message');
    if (!targetId) return { target: null, locale, originalMsg: null, hub: null };

    const originalMsg = await findOriginalMessage(targetId);
    const hub = await this.fetchHub(originalMsg?.hubId);

    return { targetId, locale, originalMsg, hub };
  }

  private async getModalMessageInfo(interaction: ModalSubmitInteraction<CacheType>) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [messageId] = customId.args;
    const originalMsg = await findOriginalMessage(messageId);

    const locale = (await fetchUserLocale(interaction.user.id)) ?? 'en';

    return { originalMsg, locale, messageId };
  }

  private buildButtons(
    client: Client,
    targetMsgId: string,
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
        modPanelButton(targetMsgId, getEmoji('hammer_icon', client)).setStyle(
          ButtonStyle.Secondary,
        ),
      );
    }
    if (opts?.inviteButtonUrl) {
      extras.push(
        new ButtonBuilder()
          .setLabel('Join Server')
          .setEmoji(getEmoji('join', client))
          .setStyle(ButtonStyle.Link)
          .setURL(opts.inviteButtonUrl)
          .setDisabled(false),
      );
    }

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.user', locale))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true) // Initially disabled since we show user info first
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'userInfo').toString()),
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.server', locale))
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'serverInfo').toString()),
        new ButtonBuilder()
          .setLabel(t('msgInfo.buttons.message', locale))
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(new CustomID().setIdentifier('msgInfo', 'msgInfo').toString()),
      ),
      new ActionRowBuilder<ButtonBuilder>({ components: extras }),
    ];
  }
}
