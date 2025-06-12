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
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import getRedis from '#src/utils/Redis.js';
import { fetchUserLocale, getReplyMethod, handleError } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
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

    // Only show hub rules if there's a hub with rules to accept
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
