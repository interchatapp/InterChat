import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type { Connection } from '#src/generated/prisma/client/client.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import { fetchConnection, handleConnectionInviteCreation } from '#src/utils/ConnectedListUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { fetchUserLocale, resolveEval } from '#src/utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export default class JoinServerCommand extends BaseCommand {
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
    // Ensure channelId is not null
    if (!ctx.channelId) {
      const locale = await ctx.getLocale();
      await ctx.reply({
        content: t('joinserver.errors.channelOnly', locale),
        flags: ['Ephemeral'],
      });
      return;
    }

    const commandChannelConnection = await fetchConnection(ctx.channelId);

    if (!commandChannelConnection) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    // Resolve the target server ID from the message or provided option.
    const targetServerId = await this.resolveTargetServerId(ctx);

    if (!targetServerId) {
      const locale = await ctx.getLocale();
      await ctx.reply({
        content: t('joinserver.errors.missingTarget', locale),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Retrieve the connection for the target server.
    const connection = await this.findTargetConnection(commandChannelConnection, targetServerId);
    // Fallback: if no invite is available from the connection, try fetching server data.
    const serverData =
      targetServerId && !connection?.invite
        ? await db.serverData.findFirst({ where: { id: targetServerId } })
        : null;

    // TODO: implement disabling join request in `/connection edit`
    if (connection?.joinRequestsDisabled) {
      await ctx.replyEmbed('connection.joinRequestsDisabled', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    const invite =
      connection?.invite ||
      (serverData?.inviteCode ? `https://discord.gg/${serverData.inviteCode}` : null);

    if (invite && targetServerId) {
      const locale = await ctx.getLocale();
      const server = await ctx.client.fetchGuild(targetServerId);
      await ctx.reply({
        content: t('joinserver.success.inviteSent', locale, {
          emoji: ctx.getEmoji('tick_icon'),
        }),
        flags: ['Ephemeral'],
      });
      await ctx.user.send(stripIndents`
        ### ${t('joinserver.request.title', locale)}
        ${t('joinserver.request.description', locale, { serverName: server?.name ?? 'Unknown' })}
        ${invite}
      `);
      return;
    }

    const webhookURL = connection?.webhookURL;
    if (!webhookURL) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    // Broadcast the join request to the server administrators.
    const locale = await ctx.getLocale();
    await BroadcastService.sendMessage(webhookURL, {
      content: t('joinserver.request.broadcast', locale, {
        username: ctx.user.username,
        guildName: ctx.guild?.name ?? 'Unknown',
      }),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              new CustomID('joinReq:accept').setArgs(ctx.user.id, ctx.channelId || '').toString(),
            )
            .setLabel(t('joinserver.buttons.accept', locale))
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(new CustomID('joinReq:reject').toString())
            .setLabel(t('joinserver.buttons.reject', locale))
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });

    await ctx.reply(
      t('joinserver.response.sent', locale, {
        emoji: ctx.getEmoji('tick_icon'),
      }),
    );
  }

  /**
   * Resolves the target server ID from a given message or option.
   */
  private async resolveTargetServerId(ctx: Context): Promise<string | null> {
    const targetMessage = await ctx.getTargetMessage('messageorserverid');
    const serverIdOpt = ctx.options.getString('messageorserverid');

    if (targetMessage) {
      const originalMessage = await findOriginalMessage(targetMessage.id);
      return originalMessage?.guildId || serverIdOpt;
    }
    const serverName = ctx.options.getString('servername');
    if (serverName) {
      // FIXME: Use database to get server names probably
      const serverId = resolveEval<string>(
        await ctx.client.cluster.broadcastEval(`
        const server = this.guilds.cache.find(g => g.name === ${JSON.stringify(serverName)});
        server?.id;
      `),
      );

      return serverId || serverIdOpt;
    }

    return serverIdOpt;
  }

  /**
   * Finds the connection for a given target server within the current hub.
   */
  private async findTargetConnection(channelConnection: Connection, targetServerId: string | null) {
    if (!targetServerId) return null;

    return await db.connection.findFirst({
      where: { hubId: channelConnection.hubId, serverId: targetServerId },
    });
  }

  @RegisterInteractionHandler('joinReq')
  async handleJoinRequest(ctx: ComponentContext) {
    if (!ctx.inGuild()) return;

    if (!ctx.member.permissions.has('ManageMessages')) {
      await ctx.reply({
        content: t('errors.missingPermissions', await fetchUserLocale(ctx.user.id), {
          emoji: getEmoji('x_icon', ctx.client),
          permissions: 'Manage Messages',
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const action = ctx.customId.suffix as 'accept' | 'reject';
    const [userId] = ctx.customId.args;
    const locale = await ctx.getLocale();

    if (action === 'reject') {
      await ctx.reply({
        content: t('global.cancelled', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      await this.updateButtonState(ctx, 'reject');
      return;
    }

    if (action === 'accept') {
      const connection = await fetchConnection(ctx.channelId);
      if (!connection) {
        await ctx.reply({
          flags: ['Ephemeral'],
          content: t('connection.notFound', locale, {
            emoji: getEmoji('x_icon', ctx.client),
          }),
        });
        return;
      }

      await ctx.reply(
        t('joinserver.response.creating', locale, {
          emoji: getEmoji('loading', ctx.client),
        }),
      );

      const inviteLink = await handleConnectionInviteCreation(ctx, connection, locale);

      const user = await ctx.client.users.fetch(userId).catch(() => null);
      if (!user) return;

      const dmStatus = await user
        .send(
          stripIndents`
        ### ${t('joinserver.request.title', locale)}
        ${t('joinserver.request.description', locale, { serverName: ctx.guild?.name })}
        ${inviteLink}
      `,
        )
        .catch(() => null);

      await ctx.editReply(
        dmStatus
          ? t('joinserver.response.dmSent', locale, {
            emoji: getEmoji('tick_icon', ctx.client),
          })
          : t('joinserver.response.dmFailed', locale, {
            emoji: getEmoji('x_icon', ctx.client),
          }),
      );

      if (dmStatus) {
        await this.updateButtonState(ctx, 'accept');
      }
    }
  }

  /**
   * Updates the state of the ctx button based on the action taken.
   */
  private async updateButtonState(ctx: ComponentContext, action: 'accept' | 'reject') {
    if (!ctx.interaction.message) return;

    const updatedButton = await this.createUpdatedButton(ctx, action);
    try {
      const webhook = await ctx.interaction.message.fetchWebhook();
      await webhook.editMessage(ctx.interaction.message, { components: [updatedButton] });
    }
    catch {
      // Fail silently if button update fails.
    }
  }

  /**
   * Creates an updated button reflecting the accepted or rejected state.
   */
  private async createUpdatedButton(
    ctx: ComponentContext,
    action: 'accept' | 'reject',
  ): Promise<ActionRowBuilder<ButtonBuilder>> {
    const locale = await ctx.getLocale();
    const isAccepted = action === 'accept';
    const buttonStyle = isAccepted ? ButtonStyle.Success : ButtonStyle.Danger;
    const statusLabel = isAccepted
      ? t('joinserver.status.accepted', locale, { username: ctx.user.username })
      : t('joinserver.status.rejected', locale, { username: ctx.user.username });
    const emoji = getEmoji(isAccepted ? 'tick_icon' : 'x_icon', ctx.client);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ctx.interaction.customId)
        .setStyle(buttonStyle)
        .setLabel(statusLabel)
        .setEmoji(emoji)
        .setDisabled(true),
    );
  }
}
