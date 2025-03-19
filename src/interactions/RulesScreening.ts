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

import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import UserDbService from '#src/services/UserDbService.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import getRedis from '#src/utils/Redis.js';
import { fetchUserLocale, getReplyMethod } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import type { User as DbUser } from '@prisma/client';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  BaseMessageOptions,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  Message,
  MessageComponentInteraction,
  RepliableInteraction,
} from 'discord.js';

async function sendRulesReply(
  repliable: Message | RepliableInteraction | MessageComponentInteraction | Context,
  message: BaseMessageOptions,
  ephemeral = false,
) {
  if (repliable instanceof Message) {
    await repliable.reply(message);
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
  catch (e) {
    Logger.error(e);
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
  async showRules(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId] = customId.args;
    const locale = await fetchUserLocale(interaction.user.id);

    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} These rules are not for you!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const rulesContent = stripIndents`
      ${t('rules.rules', locale, {
        emoji: getEmoji('rules_icon', interaction.client),
        guidelines_link: `${Constants.Links.Website}/guidelines`,
      })}
      ${t('rules.agreementNote', locale)}
    `;

    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:accept').setArgs(userId).toString())
        .setLabel(t('rules.accept', locale))
        .setStyle(ButtonStyle.Success)
        .setEmoji(getEmoji('tick_icon', interaction.client)),
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:decline').setArgs(userId).toString())
        .setLabel(t('rules.decline', locale))
        .setStyle(ButtonStyle.Danger)
        .setEmoji(getEmoji('x_icon', interaction.client)),
    );

    const rulesEmbed = new InfoEmbed()
      .setDescription(rulesContent)
      .setColor(Constants.Colors.invisible);

    await interaction.editReply({ content: null, embeds: [rulesEmbed], components: [components] });
  }

  @RegisterInteractionHandler('rulesScreen', 'accept')
  async handleBotRulesAccept(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId] = customId.args;

    // Add security check
    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} You cannot accept rules for other users!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const userService = new UserDbService();
    await userService.upsertUser(interaction.user.id, { acceptedRules: true });

    // Check if there's a pending hub rules acceptance needed
    const locale = await fetchUserLocale(interaction.user.id);

    // Try to get hub context from MessageProcessor
    const hubContext = await db.connection.findFirst({
      where: { channelId: interaction.channelId },
      include: { hub: { include: { rulesAcceptances: { where: { userId } } } } },
    });

    if (
      hubContext?.hub &&
      hubContext.hub.rules.length > 0 &&
      hubContext.hub.rulesAcceptances.length === 0
    ) {
      // Show hub rules immediately after accepting bot rules
      await showHubRules(interaction, userId, new HubManager(hubContext.hub), locale);
      return;
    }

    await interaction.deleteReply();

    // If no hub rules to show, display success message
    const embed = new InfoEmbed().setDescription(
      t('rules.accepted', locale, {
        support_invite: Constants.Links.SupportInvite,
        donateLink: Constants.Links.Donate,
        emoji: getEmoji('tick_icon', interaction.client),
      }),
    );

    await interaction.followUp({ embeds: [embed], components: [], flags: ['Ephemeral'] });
  }

  @RegisterInteractionHandler('rulesScreen', 'acceptHub')
  async handleHubRulesAccept(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = customId.args;

    // Add security check
    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} You cannot accept rules for other users!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await db.hubRulesAcceptance.create({
      data: {
        userId,
        hubId,
      },
    });

    await interaction.deleteReply();

    const locale = await fetchUserLocale(interaction.user.id);
    const embed = new InfoEmbed().setDescription(
      t('rules.hubAccepted', locale, {
        emoji: getEmoji('tick_icon', interaction.client),
      }),
    );

    await interaction.followUp({ embeds: [embed], components: [], flags: ['Ephemeral'] });
    await this.redis.del(`${RedisKeys.RulesShown}:${interaction.user.id}:${hubId}`);
  }

  @RegisterInteractionHandler('rulesScreen', 'decline')
  async handleBotRulesDecline(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();
    const locale = await fetchUserLocale(interaction.user.id);

    const embed = new InfoEmbed()
      .setDescription(
        t('rules.declined', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      )
      .setColor('Red');

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  @RegisterInteractionHandler('rulesScreen', 'declineHub')
  async handleHubRulesDecline(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();
    const customId = CustomID.parseCustomId(interaction.customId);
    const [, hubId] = customId.args;

    const locale = await fetchUserLocale(interaction.user.id);
    const hub = await new HubService().fetchHub(hubId);

    const embed = new InfoEmbed()
      .setDescription(
        t('rules.hubDeclined', locale, {
          emoji: getEmoji('x_icon', interaction.client),
          hubName: hub?.data.name ?? 'this hub',
        }),
      )
      .setColor('Red');

    await interaction.editReply({ embeds: [embed], components: [] });
    await this.redis.del(`${RedisKeys.RulesShown}:${interaction.user.id}:${hubId}`);
  }
}
