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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import BanManager from '#src/managers/UserBanManager.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';

import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { checkIfStaff, fetchUserLocale } from '#src/utils/Utils.js';
import { isStaffOrHubMod } from '#src/utils/hub/utils.js';
import { isDeleteInProgress } from '#src/utils/moderation/deleteMessage.js';
import RemoveReactionsHandler from '#src/utils/moderation/modPanel/handlers/RemoveReactionsHandler.js';
import {
  BlacklistServerHandler,
  BlacklistUserHandler,
} from '#src/utils/moderation/modPanel/handlers/blacklistHandler.js';
import DeleteMessageHandler from '#src/utils/moderation/modPanel/handlers/deleteMsgHandler.js';
import ServerBanHandler from '#src/utils/moderation/modPanel/handlers/serverBanHandler.js';
import UserBanHandler from '#src/utils/moderation/modPanel/handlers/userBanHandler.js';
import ViewInfractionsHandler from '#src/utils/moderation/modPanel/handlers/viewInfractions.js';
import WarnHandler from '#src/utils/moderation/modPanel/handlers/warnHandler.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ContainerBuilder,
  type Interaction,
  type Snowflake,
  TextDisplayBuilder,
} from 'discord.js';

type BuilderOpts = {
  isUserBlacklisted: boolean;
  isServerBlacklisted: boolean;
  isDeleteInProgress: boolean;
  isBanned: boolean;
  isServerBanned: boolean;
};

export default class ModPanelHandler {
  private readonly modActionHandlers = {
    deleteMsg: new DeleteMessageHandler(),
    banUser: new UserBanHandler(),
    banServer: new ServerBanHandler(),
    blacklistUser: new BlacklistUserHandler(),
    blacklistServer: new BlacklistServerHandler(),
    removeAllReactions: new RemoveReactionsHandler(),
    viewInfractions: new ViewInfractionsHandler(),
    warnUser: new WarnHandler(),
  };

  @RegisterInteractionHandler('modPanel')
  async handleButtons(ctx: ComponentContext): Promise<void> {
    const [originalMsgId] = ctx.customId.args;
    const locale = await fetchUserLocale(ctx.user.id);

    if (!(await this.validateUser(ctx, locale))) return;

    const handler =
      this.modActionHandlers[ctx.customId.suffix as keyof typeof this.modActionHandlers];
    if (handler) {
      await handler.handle(ctx, originalMsgId, locale);
    }
  }

  @RegisterInteractionHandler('blacklist_duration')
  async handleDurationSelect(ctx: ComponentContext): Promise<void> {
    const [originalMsgId, duration] = ctx.customId.args;
    const locale = await fetchUserLocale(ctx.user.id);

    // Get the handler based on the type (user or server)
    const handlerType = ctx.customId.suffix === 'user' ? 'blacklistUser' : 'blacklistServer';
    const handler = this.modActionHandlers[handlerType];

    if (handler && 'handleDurationSelect' in handler) {
      await handler.handleDurationSelect(ctx, originalMsgId, duration, locale);
    }
  }
  private async validateUser(ctx: ComponentContext, locale: supportedLocaleCodes) {
    // Get the original message to check hub permissions
    const originalMsg = await getOriginalMessage(ctx.customId.args[0]);
    if (!originalMsg) {
      const embed = new InfoEmbed().setDescription(
        t('errors.messageNotSentOrExpired', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return false;
    }

    // Check if user is staff or hub moderator
    const hubService = new HubService();
    const hub = await hubService.fetchHub(originalMsg.hubId);
    if (!hub || !(await isStaffOrHubMod(ctx.user.id, hub))) {
      const embed = new InfoEmbed().setDescription(
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return false;
    }

    return true;
  }

  @RegisterInteractionHandler('blacklist_reason_modal')
  @RegisterInteractionHandler('blacklist_custom_modal')
  async handleBlacklistModal(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    if (!ctx.isModalSubmit()) return;

    const [originalMsgId] = ctx.customId.args;
    const originalMsg = await getOriginalMessage(originalMsgId);
    const locale = await fetchUserLocale(ctx.user.id);

    if (!originalMsg || !(await this.validateMessage(ctx, originalMsg, locale))) {
      return;
    }
    const handlerId = ctx.customId.suffix === 'user' ? 'blacklistUser' : 'blacklistServer';
    const handler = this.modActionHandlers[handlerId];
    if (handler?.handleModal) {
      await handler.handleModal(ctx, originalMsg, locale);
    }
  }
  private async validateMessage(
    ctx: ComponentContext,
    originalMsg: MessageDB,
    locale: supportedLocaleCodes,
  ) {
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(originalMsg.hubId);
    if (!hub || !(await isStaffOrHubMod(ctx.user.id, hub))) {
      const embed = new InfoEmbed().setDescription(
        t('errors.messageNotSentOrExpired', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );
      await ctx.editReply({ embeds: [embed] });
      return false;
    }

    return true;
  }
}

export async function buildModPanel(ctx: Context | Interaction, originalMsg: MessageDB) {
  const user = await ctx.client.users.fetch(originalMsg.authorId);
  const server = await ctx.client.fetchGuild(originalMsg.guildId);
  const deleteInProgress = await isDeleteInProgress(originalMsg.id);

  const userBlManager = new BlacklistManager('user', originalMsg.authorId);
  const serverBlManager = new BlacklistManager('server', originalMsg.guildId);
  const banManager = new BanManager();
  const serverBanManager = new ServerBanManager();

  const isUserBlacklisted = Boolean(await userBlManager.fetchBlacklist(originalMsg.hubId));
  const isServerBlacklisted = Boolean(await serverBlManager.fetchBlacklist(originalMsg.hubId));

  // Check for user ban
  const userBanCheck = await banManager.isUserBanned(user.id);
  const isBanned = userBanCheck.isBanned;

  // Check for server ban
  const serverBanCheck = await serverBanManager.isServerBanned(originalMsg.guildId);
  const isServerBanned = serverBanCheck.isBanned;

  const container = buildModPanelContainer(
    user.username,
    server?.name ?? 'Unknown Server',
    ctx.client,
    {
      isUserBlacklisted,
      isServerBlacklisted,
      isBanned,
      isServerBanned,
      isDeleteInProgress: deleteInProgress,
    },
    originalMsg.id,
  );

  const buttons = buildButtons(ctx, originalMsg.id, {
    isUserBlacklisted,
    isServerBlacklisted,
    isBanned,
    isServerBanned,
    isDeleteInProgress: deleteInProgress,
  });

  return { container, buttons };
}

function buildButtons(ctx: Context | Interaction, messageId: Snowflake, opts: BuilderOpts) {
  const author = ctx.user;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Create main action row with view infractions
  const mainRow = new ActionRowBuilder<ButtonBuilder>();

  // Always add view infractions button
  mainRow.addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:viewInfractions', [messageId]).toString())
      .setLabel('View History')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('exclamation', ctx.client)),
  );

  // Add staff-only ban buttons with clear visual distinction
  if (checkIfStaff(author.id)) {
    // User ban button
    const userBanButton = new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:banUser', [messageId]).toString())
      .setLabel(opts.isBanned ? 'User Banned' : 'Ban User')
      .setStyle(opts.isBanned ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setEmoji(getEmoji('hammer_icon', ctx.client))
      .setDisabled(opts.isBanned);

    // Server ban button
    const serverBanButton = new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:banServer', [messageId]).toString())
      .setLabel(opts.isServerBanned ? 'Server Banned' : 'Ban Server')
      .setStyle(opts.isServerBanned ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setEmoji(getEmoji('staff', ctx.client))
      .setDisabled(opts.isServerBanned);

    mainRow.addComponents(userBanButton, serverBanButton);
  }

  rows.push(mainRow);
  return rows;
}

function buildModPanelContainer(
  username: string,
  servername: string,
  client: Client,
  opts: BuilderOpts,
  messageId: Snowflake,
): ContainerBuilder {
  const container = new ContainerBuilder();

  // Create compact header with status indicators
  const statusIndicators = [];
  if (opts.isUserBlacklisted) statusIndicators.push(`${getEmoji('dotRed', client)} User Blacklisted`);
  if (opts.isServerBlacklisted) statusIndicators.push(`${getEmoji('dotRed', client)} Server Blacklisted`);
  if (opts.isBanned) statusIndicators.push(`${getEmoji('dotRed', client)} User Banned`);
  if (opts.isServerBanned) statusIndicators.push(`${getEmoji('dotRed', client)} Server Banned`);
  if (opts.isDeleteInProgress) statusIndicators.push(`${getEmoji('dotRed', client)} Deleting...`);

  const headerContent = stripIndents`
    ## ${getEmoji('hammer_icon', client)} Moderation Panel
    **Target:** ${username} • **Server:** ${servername}
    ${statusIndicators.length > 0 ? `**Status:** ${statusIndicators.join(' • ')}` : ''}
  `;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));

  // Content Actions Group (Primary moderation actions)
  container.addActionRowComponents((row) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('modPanel:deleteMsg', [messageId]).toString())
        .setLabel('Delete Message')
        .setStyle(opts.isDeleteInProgress ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setEmoji(getEmoji('delete_icon', client))
        .setDisabled(opts.isDeleteInProgress),
      new ButtonBuilder()
        .setCustomId(new CustomID('modPanel:removeAllReactions', [messageId]).toString())
        .setLabel('Clear Reactions')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('plus_icon', client)),
      new ButtonBuilder()
        .setCustomId(new CustomID('modPanel:warnUser', [messageId]).toString())
        .setLabel('Warn')
        .setStyle(ButtonStyle.Primary)
        .setEmoji(getEmoji('alert_icon', client)),
    );
    return row;
  });

  // Hub Actions Group (Blacklist actions)
  container.addActionRowComponents((row) => {
    const userButton = new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:blacklistUser', [messageId]).toString())
      .setLabel(opts.isUserBlacklisted ? 'User Blacklisted' : 'Blacklist User')
      .setStyle(opts.isUserBlacklisted ? ButtonStyle.Secondary : ButtonStyle.Secondary)
      .setEmoji(getEmoji('person_icon', client))
      .setDisabled(opts.isUserBlacklisted);

    const serverButton = new ButtonBuilder()
      .setCustomId(new CustomID('modPanel:blacklistServer', [messageId]).toString())
      .setLabel(opts.isServerBlacklisted ? 'Server Blacklisted' : 'Blacklist Server')
      .setStyle(opts.isServerBlacklisted ? ButtonStyle.Secondary : ButtonStyle.Secondary)
      .setEmoji(getEmoji('globe_icon', client))
      .setDisabled(opts.isServerBlacklisted);

    row.addComponents(userButton, serverButton);
    return row;
  });

  return container;
}
