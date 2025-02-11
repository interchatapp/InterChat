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

import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { checkIfStaff, fetchUserData, fetchUserLocale } from '#src/utils/Utils.js';
import { isStaffOrHubMod } from '#src/utils/hub/utils.js';
import { isDeleteInProgress } from '#src/utils/moderation/deleteMessage.js';
import RemoveReactionsHandler from '#src/utils/moderation/modPanel/handlers/RemoveReactionsHandler.js';
import {
  BlacklistServerHandler,
  BlacklistUserHandler,
} from '#src/utils/moderation/modPanel/handlers/blacklistHandler.js';
import DeleteMessageHandler from '#src/utils/moderation/modPanel/handlers/deleteMsgHandler.js';
import UserBanHandler from '#src/utils/moderation/modPanel/handlers/userBanHandler.js';
import ViewInfractionsHandler from '#src/utils/moderation/modPanel/handlers/viewInfractions.js';
import { type OriginalMessage, getOriginalMessage } from '#src/utils/network/messageUtils.js';
import Constants from '#utils/Constants.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type Interaction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type Snowflake,
} from 'discord.js';

type BuilderOpts = {
  isUserBlacklisted: boolean;
  isServerBlacklisted: boolean;
  isDeleteInProgress: boolean;
  isBanned: boolean;
};

export default class ModPanelHandler {
  private readonly modActionHandlers = {
    deleteMsg: new DeleteMessageHandler(),
    banUser: new UserBanHandler(),
    blacklistUser: new BlacklistUserHandler(),
    blacklistServer: new BlacklistServerHandler(),
    removeAllReactions: new RemoveReactionsHandler(),
    viewInfractions: new ViewInfractionsHandler(),
  };

  @RegisterInteractionHandler('modPanel')
  async handleButtons(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId, originalMsgId] = customId.args;
    const locale = await fetchUserLocale(interaction.user.id);

    if (!(await this.validateUser(interaction, userId, locale))) return;

    const handler = this.modActionHandlers[customId.suffix as keyof typeof this.modActionHandlers];
    if (handler) {
      await handler.handle(interaction, originalMsgId, locale);
    }
  }
  private async validateUser(
    interaction: RepliableInteraction,
    userId: string,
    locale: supportedLocaleCodes,
  ) {
    if (interaction.user.id !== userId) {
      const embed = new InfoEmbed().setDescription(
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );

      await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return false;
    }

    return true;
  }

  @RegisterInteractionHandler('blacklist_modal')
  async handleBlacklistModal(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [originalMsgId] = customId.args;
    const originalMsg = await getOriginalMessage(originalMsgId);
    const locale = await fetchUserLocale(interaction.user.id);

    if (!originalMsg || !(await this.validateMessage(interaction, originalMsg, locale))) {
      return;
    }
    const handlerId = customId.suffix === 'user' ? 'blacklistUser' : 'blacklistServer';
    const handler = this.modActionHandlers[handlerId];
    if (handler?.handleModal) {
      await handler.handleModal(interaction, originalMsg, locale);
    }
  }
  private async validateMessage(
    interaction: RepliableInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ) {
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(originalMsg.hubId);
    if (!hub || !(await isStaffOrHubMod(interaction.user.id, hub))) {
      const embed = new InfoEmbed().setDescription(
        t('errors.messageNotSentOrExpired', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );
      await interaction.editReply({ embeds: [embed] });
      return false;
    }

    return true;
  }
}

export async function buildModPanel(
  ctx: Context | Interaction,
  originalMsg: OriginalMessage,
) {
  const user = await ctx.client.users.fetch(originalMsg.authorId);
  const server = await ctx.client.fetchGuild(originalMsg.guildId);
  const deleteInProgress = await isDeleteInProgress(originalMsg.messageId);

  const userBlManager = new BlacklistManager('user', originalMsg.authorId);
  const serverBlManager = new BlacklistManager('server', originalMsg.guildId);

  const isUserBlacklisted = Boolean(await userBlManager.fetchBlacklist(originalMsg.hubId));
  const isServerBlacklisted = Boolean(await serverBlManager.fetchBlacklist(originalMsg.hubId));
  const dbUserTarget = await fetchUserData(user.id);

  const embed = buildInfoEmbed(
    user.username,
    server?.name ?? 'Unknown Server',
    ctx.client,
    {
      isUserBlacklisted,
      isServerBlacklisted,
      isBanned: Boolean(dbUserTarget?.banReason),
      isDeleteInProgress: deleteInProgress,
    },
  );

  const buttons = buildButtons(ctx, originalMsg.messageId, {
    isUserBlacklisted,
    isServerBlacklisted,
    isBanned: Boolean(dbUserTarget?.banReason),
    isDeleteInProgress: deleteInProgress,
  });

  return { embed, buttons };
}

function buildButtons(ctx: Context | Interaction, messageId: Snowflake, opts: BuilderOpts) {
  const author = ctx.user;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:blacklistUser', [author.id, messageId]).toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('person_icon', ctx.client))
      .setDisabled(opts.isUserBlacklisted),
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:blacklistServer', [author.id, messageId]).toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('globe_icon', ctx.client))
      .setDisabled(opts.isServerBlacklisted),
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:removeAllReactions', [author.id, messageId]).toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('plus_icon', ctx.client)),
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:deleteMsg', [author.id, messageId]).toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('delete_icon', ctx.client))
      .setDisabled(opts.isDeleteInProgress),
  );

  if (checkIfStaff(author.id)) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('modPanel:banUser', [author.id, messageId]).toString())
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('hammer_icon', ctx.client))
        .setDisabled(opts.isBanned),
    );
  }

  const extras = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:viewInfractions', [author.id, messageId]).toString())
      .setLabel('View Infractions')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('exclamation', ctx.client)),
  );

  return [buttons, extras];
}

function buildInfoEmbed(username: string, servername: string, client: Client, opts: BuilderOpts) {
  const userEmbedDesc = opts.isUserBlacklisted
    ? `~~User **${username}** is already blacklisted.~~`
    : `Blacklist user **${username}** from this hub.`;

  const serverEmbedDesc = opts.isServerBlacklisted
    ? `~~Server **${servername}** is already blacklisted.~~`
    : `Blacklist server **${servername}** from this hub.`;

  const deleteDesc = opts.isDeleteInProgress
    ? '~~Message is already deleted or is being deleted.~~'
    : 'Delete this message from all connections.';

  const banUserDesc = opts.isBanned
    ? '~~This user is already banned.~~'
    : 'Ban this user from the entire bot.';

  return new EmbedBuilder()
    .setColor(Constants.Colors.invisible)
    .setFooter({
      text: 'Target will be notified of the blacklist. Use /blacklist list to view all blacklists.',
    })
    .setDescription(stripIndents`
        ### ${getEmoji('clock_icon', client)} Moderation Actions
        **${getEmoji('person_icon', client)} Blacklist User**: ${userEmbedDesc}
        **${getEmoji('globe_icon', client)} Blacklist Server**: ${serverEmbedDesc}
        **${getEmoji('plus_icon', client)} Remove Reactions**: Remove all reactions from this message.
        **${getEmoji('delete_icon', client)} Delete Message**: ${deleteDesc}
        **${getEmoji('hammer_icon', client)} Ban User**: ${banUserDesc}
    `);
}
