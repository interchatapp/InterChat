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
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type { User as DbUser } from '#src/generated/prisma/client/client.js';
import HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import UserDbService from '#src/services/UserDbService.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import getRedis from '#src/utils/Redis.js';
import { fetchUserLocale, getReplyMethod, handleError } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  type BaseMessageOptions,
  ButtonBuilder,
  ButtonStyle,
  Message,
  type MessageComponentInteraction,
  type RepliableInteraction,
} from 'discord.js';

async function sendRulesReply(
  repliable: Message | RepliableInteraction | MessageComponentInteraction | Context,
  message: BaseMessageOptions,
  ephemeral = false,
) {
  if (repliable instanceof Message) {
    try {
      await repliable.reply(message);
    }
    catch {
      // If reply fails (most likely due to missing "read message history" permission), try to send in the channel
      if (repliable.channel.isSendable()) await repliable.channel.send(message);
    }
  }
  else if (repliable instanceof Context) {
    await repliable.editOrReply({ ...message });
  }
  else if (repliable.replied || repliable.deferred) {
    await repliable.editReply(message);
  }
  else {
    const replyMethod = getReplyMethod(repliable);
    await repliable[replyMethod]({ ...message, flags: ephemeral ? ['Ephemeral'] : [] });
  }
}

export const showRulesScreening = async (
  repliable: Message | RepliableInteraction | MessageComponentInteraction | Context,
  userData: DbUser | null,
  hub?: HubManager,
) => {
  try {
    const author = repliable instanceof Message ? repliable.author : repliable.user;
    const locale = userData ? await fetchUserLocale(userData) : 'en';

    // If user hasn't accepted bot rules, show them first regardless of hub
    if (!userData?.acceptedRules) {
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('rulesScreen:continue').setArgs(author.id).toString())
          .setLabel(t('rules.continue', locale))
          .setStyle(ButtonStyle.Primary),
      );

      const welcomeMsg = {
        content: t('rules.welcome', locale, {
          emoji: getEmoji('wave_anim', repliable.client),
          user: author.username,
        }),
        components: [buttons],
      };

      await sendRulesReply(repliable, welcomeMsg, true);
      return;
    }

    // If user has accepted bot rules but there's a hub with rules to accept, show hub rules
    if (hub && hub.getRules().length > 0) {
      await showHubRules(repliable, author.id, hub, locale);
    }
  }
  catch (err) {
    handleError(err, { comment: 'Error in showRulesScreening:' });
  }
};

async function showHubRules(
  repliable: Message | RepliableInteraction | MessageComponentInteraction | Context,
  userId: string,
  hub: HubManager,
  locale: supportedLocaleCodes,
) {
  const hubRules = hub.getRules();
  const formattedRules = hubRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');

  const rulesContent = `## ${getEmoji('rules_icon', repliable.client)} ${hub.data.name} | Hub Rules
    ${formattedRules}

    ${t('rules.hubAgreementNote', locale)}
  `;

  const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('rulesScreen:acceptHub').setArgs(userId, hub.id).toString())
      .setLabel(t('rules.accept', locale))
      .setStyle(ButtonStyle.Success)
      .setEmoji(getEmoji('tick_icon', repliable.client)),
    new ButtonBuilder()
      .setCustomId(new CustomID('rulesScreen:declineHub').setArgs(userId, hub.id).toString())
      .setLabel(t('rules.decline', locale))
      .setStyle(ButtonStyle.Danger)
      .setEmoji(getEmoji('x_icon', repliable.client)),
  );

  const rulesEmbed = new InfoEmbed()
    .setThumbnail(hub.data.iconUrl)
    .setDescription(rulesContent)
    .setColor(Constants.Colors.invisible);

  const message = { embeds: [rulesEmbed], components: [components] };
  await sendRulesReply(repliable, message, true);
}

export default class RulesScreeningInteraction {
  private readonly redis = getRedis();

  @RegisterInteractionHandler('rulesScreen', 'continue')
  async showRules(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const customId = ctx.customId;
    const [userId] = customId.args;
    const locale = await fetchUserLocale(ctx.user.id);

    if (ctx.user.id !== userId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} These rules are not for you!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const rulesContent = stripIndents`
      ${t('rules.header', locale)}
      ${t('rules.botRulesNote', locale)}
      ${t('rules.rules', locale, { guidelines_link: `${Constants.Links.Website}/guidelines` })}
      ${t('rules.agreementNote', locale)}
    `;

    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:accept').setArgs(userId).toString())
        .setLabel(t('rules.accept', locale))
        .setStyle(ButtonStyle.Success)
        .setEmoji(getEmoji('tick_icon', ctx.client)),
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:decline').setArgs(userId).toString())
        .setLabel(t('rules.decline', locale))
        .setStyle(ButtonStyle.Danger)
        .setEmoji(getEmoji('x_icon', ctx.client)),
    );

    const rulesEmbed = new InfoEmbed()
      .setDescription(rulesContent)
      .setColor(Constants.Colors.invisible);

    await ctx.editReply({ content: null, embeds: [rulesEmbed], components: [components] });
  }

  @RegisterInteractionHandler('rulesScreen', 'accept')
  async handleBotRulesAccept(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [userId] = ctx.customId.args;

    // Add security check
    if (ctx.user.id !== userId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} You cannot accept rules for other users!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const userService = new UserDbService();
    await userService.upsertUser(ctx.user.id, {
      acceptedRules: true,
      name: ctx.user.username,
      image: ctx.user.avatarURL(),
    });

    // Check if there's a pending hub rules acceptance needed
    const locale = await fetchUserLocale(ctx.user.id);

    if (ctx.channelId) {
      // Try to get hub context from MessageProcessor
      const hubContext = await db.connection.findFirst({
        where: { channelId: ctx.channelId },
        include: { hub: { include: { rulesAcceptances: { where: { userId } } } } },
      });

      // Show hub rules immediately after accepting bot rules
      if (hubContext?.hub.rulesAcceptances.length === 0 && hubContext.hub.rules.length > 0) {
        await showHubRules(ctx, userId, new HubManager(hubContext.hub), locale);
        return;
      }
    }

    await ctx.deleteReply();

    // If no hub rules to show, display success message
    const embed = new InfoEmbed().setDescription(
      t('rules.accepted', locale, {
        support_invite: Constants.Links.SupportInvite,
        donateLink: Constants.Links.Donate,
        emoji: getEmoji('tick_icon', ctx.client),
        dashboard_link: `${Constants.Links.Website}/dashboard`,
      }),
    );

    await ctx.reply({ embeds: [embed], components: [], flags: ['Ephemeral'] });
  }

  @RegisterInteractionHandler('rulesScreen', 'acceptHub')
  async handleHubRulesAccept(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [userId, hubId] = ctx.customId.args;

    // Add security check
    if (ctx.user.id !== userId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} You cannot accept rules for other users!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    try {
      // Check if the user has already accepted the rules for this hub
      const existingAcceptance = await db.hubRulesAcceptance.findUnique({
        where: { userId_hubId: { userId, hubId } },
      });

      // If no existing acceptance, create a new one
      if (!existingAcceptance) {
        await db.hubRulesAcceptance.create({ data: { userId, hubId } });
      }
      // If there is an existing acceptance, we don't need to do anything
      // The user has already accepted the rules for this hub

      await ctx.deleteReply();

      const locale = await fetchUserLocale(ctx.user.id);
      const embed = new InfoEmbed().setDescription(
        t('rules.hubAccepted', locale, {
          emoji: getEmoji('tick_icon', ctx.client),
        }),
      );

      await ctx.reply({ embeds: [embed], components: [], flags: ['Ephemeral'] }).catch(() => null);

      // Clear both the rules shown cache and the hub connections cache
      await this.redis.del(`${RedisKeys.HubRules}:shown:${hubId}:${ctx.user.id}`);
    }
    catch (err) {
      handleError(err, { comment: 'Error in handleHubRulesAccept:', repliable: ctx.interaction });
    }
  }

  @RegisterInteractionHandler('rulesScreen', 'decline')
  async handleBotRulesDecline(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();
    const locale = await fetchUserLocale(ctx.user.id);

    const embed = new InfoEmbed()
      .setDescription(
        t('rules.declined', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      )
      .setColor('Red');

    await ctx.editReply({ embeds: [embed], components: [] });
  }

  @RegisterInteractionHandler('rulesScreen', 'declineHub')
  async handleHubRulesDecline(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();
    const customId = ctx.customId;
    const [, hubId] = customId.args;

    const locale = await fetchUserLocale(ctx.user.id);
    const hub = await new HubService().fetchHub(hubId);

    const embed = new InfoEmbed()
      .setDescription(
        t('rules.hubDeclined', locale, {
          emoji: getEmoji('x_icon', ctx.client),
          hubName: hub?.data.name ?? 'this hub',
        }),
      )
      .setColor('Red');

    await ctx.editReply({ embeds: [embed], components: [] });
    await this.redis.del(`${RedisKeys.HubRules}:shown:${hubId}:${ctx.user.id}`);
  }
}
