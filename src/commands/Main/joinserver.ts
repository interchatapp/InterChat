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
import { fetchUserLocale, resolveEval } from '#src/utils/Utils.js';
import type { Connection } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ModalSubmitInteraction,
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
    const commandChannelConnection = await fetchConnection(ctx.channelId);

    if (!commandChannelConnection) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    // Resolve the target server ID from the message or provided option.
    const targetServerId = await this.resolveTargetServerId(ctx);

    if (!targetServerId) {
      await ctx.reply({
        content: 'You must provide a message ID or server ID',
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
      const server = await ctx.client.fetchGuild(targetServerId);
      await ctx.reply({
        content: `${ctx.getEmoji('tick_icon')} I have DM'd you the invite link to the server!`,
        flags: ['Ephemeral'],
      });
      await ctx.user.send(stripIndents`
        ### Join Request
        You requested to join the server \`${server?.name}\` through InterChat. Here is the invite link:
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
  async handleJoinRequest(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;

    if (!interaction.member.permissions.has('ManageMessages')) {
      await interaction.reply({
        content: t('errors.missingPermissions', await fetchUserLocale(interaction.user.id), {
          emoji: getEmoji('x_icon', interaction.client),
          permissions: 'Manage Messages',
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

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
      await this.updateButtonState(interaction, 'reject');
      return;
    }

    if (action === 'accept') {
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
        ${inviteLink}
      `,
        )
        .catch(() => null);

      await interaction.editReply(
        dmStatus
          ? `${getEmoji('tick_icon', interaction.client)} The invite link has been sent to the user.`
          : `${getEmoji('x_icon', interaction.client)} The invite link could not be sent to the user. They may have DMs disabled.`,
      );

      if (dmStatus) {
        await this.updateButtonState(interaction, 'accept');
      }
    }
  }

  /**
   * Updates the state of the interaction button based on the action taken.
   */
  private async updateButtonState(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    action: 'accept' | 'reject',
  ) {
    if (!interaction.message) return;

    const updatedButton = this.createUpdatedButton(interaction, action);
    try {
      const webhook = await interaction.message.fetchWebhook();
      await webhook.editMessage(interaction.message, { components: [updatedButton] });
    }
    catch {
      // Fail silently if button update fails.
    }
  }

  /**
   * Creates an updated button reflecting the accepted or rejected state.
   */
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
