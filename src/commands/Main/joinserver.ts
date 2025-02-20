import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import { fetchConnection, handleConnectionInviteCreation } from '#src/utils/ConnectedListUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import type { Connection } from '@prisma/client';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';

export default class JoinRequestCommand extends BaseCommand {
  constructor() {
    super({
      name: 'joinserver',
      description: 'Join a server or send a request to join a server through InterChat.',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
      options: [
        {
          name: 'servername',
          description: 'The name of the server you want to join',
          type: ApplicationCommandOptionType.String,
          required: false,
          autocomplete: true,
        },
        {
          name: 'messageorserverid',
          description: 'The message ID or server ID',
          required: false,
          type: ApplicationCommandOptionType.String,
          min_length: 17,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    const targetMessage = await ctx.getTargetMessage('messageorserverid');

    const commandChannelConnection = await fetchConnection(ctx.channelId);
    if (!commandChannelConnection) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    const targetServerId = await this.getTargetServerId(
      targetMessage,
      ctx.options.getString('messageorserverid'),
    );

    if (!targetMessage && !targetServerId) {
      // TODO: Use localizations
      await ctx.reply('You must provide a message ID or server ID');
      return;
    }

    const connection = await this.getTargetConnection(commandChannelConnection, targetServerId);

    if (connection?.invite) {
      const server = await ctx.client.fetchGuild(connection.serverId);
      await ctx.reply({
        content: 'I have DM\'d you the invite link to the server!',
        flags: ['Ephemeral'],
      });
      await ctx.user.send(`
        ### Join Request
        You requested to join the server \`${server?.name}\` through InterChat. Here is the invite link:
        ${connection.invite}
      `);
    }

    if (connection?.joinRequestsDisabled) {
      await ctx.replyEmbed('connection.joinRequestsDisabled', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    const webhookURL = connection?.webhookURL;

    if (!webhookURL) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    await BroadcastService.sendMessage(webhookURL, {
      content: `User \`${ctx.user.username}\` from \`${ctx.guild?.name}\` has requested to join this server. Do you want to accept them?`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              new CustomID('joinReq:accept').setArgs(ctx.user.id, ctx.channelId).toString(),
            )
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(new CustomID('joinReq:reject').toString())
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });

    await ctx.reply(
      `${ctx.getEmoji('tick_icon')} Your request has been sent to the server. You will be DM'd the invite link if accepted.`,
    );
  }

  private async getTargetConnection(isChannelConnected: Connection, targetServerId: string | null) {
    if (!targetServerId) return null;

    return await db.connection.findFirst({
      where: { hubId: isChannelConnected.hubId, serverId: targetServerId },
    });
  }

  private async getTargetServerId(targetMessage: Message | null, serverIdOpt: string | null) {
    if (targetMessage) {
      const originalMessage = await findOriginalMessage(targetMessage.id);
      return originalMessage?.guildId ?? serverIdOpt;
    }
    return serverIdOpt;
  }

  @RegisterInteractionHandler('joinReq')
  async handleJoinRequest(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const action = customId.suffix as 'accept' | 'reject';
    const [userId] = customId.args;
    const locale = await fetchUserLocale(interaction.user.id);

    if (action === 'reject') {
      await interaction.reply({
        content: t('global.cancelled', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });

      await this.setButtonState(interaction, 'reject');
      return;
    }

    if (action === 'accept') {
      // TODO: maybe send error for this too
      if (!interaction.inCachedGuild()) return;
      const connection = await fetchConnection(interaction.channelId);

      if (!connection) {
        await interaction.reply({
          flags: ['Ephemeral'],
          content: t('connection.notFound', locale, {
            emoji: getEmoji('x_icon', interaction.client),
          }),
        });
        return;
      }

      await interaction.reply(
        `${getEmoji('loading', interaction.client)} This server does not have an invite link yet. Creating one...`,
      );
      const inviteLink = await handleConnectionInviteCreation(interaction, connection, locale);

      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (!user) return;

      const dmStatus = await user
        .send(
          stripIndents`
          ### Join Request
          You requested to join the server \`${interaction.guild?.name}\` through InterChat. Here is the invite link:
          ${inviteLink}`,
        )
        .catch(() => null);

      await interaction.editReply(
        dmStatus
          ? `${getEmoji('tick_icon', interaction.client)} The invite link has been sent to the user.`
          : `${getEmoji('x_icon', interaction.client)} The invite link could not be sent to the user. They may have DMs disabled.`,
      );

      if (dmStatus) await this.setButtonState(interaction, 'accept');
    }
  }

  private async setButtonState(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    action: 'accept' | 'reject',
  ) {
    if (!interaction.message) return;

    const button = this.createUpdatedButton(interaction, action);

    (await interaction.message.fetchWebhook())
      .editMessage(interaction.message, { components: [button] })
      .catch(() => null);
  }
  private createUpdatedButton(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    action: 'accept' | 'reject',
  ): ActionRowBuilder<ButtonBuilder> {
    const isAccepted = action === 'accept';
    const buttonStyle = isAccepted ? ButtonStyle.Success : ButtonStyle.Danger;
    const statusLabel = `${isAccepted ? 'Accepted' : 'Rejected'} by ${interaction.user.username}`;
    const emoji = getEmoji(isAccepted ? 'tick_icon' : 'x_icon', interaction.client);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setStyle(buttonStyle)
        .setLabel(statusLabel)
        .setEmoji(emoji)
        .setDisabled(true),
    );
  }
}
