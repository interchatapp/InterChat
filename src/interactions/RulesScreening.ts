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

import type { UserData } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Interaction,
  Message,
} from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import UserDbService from '#src/services/UserDbService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { fetchUserData, fetchUserLocale, getReplyMethod, handleError } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';

export const showRulesScreening = async (
  repliable: Interaction | Message,
  userData?: UserData | null,
) => {
  try {
    const author = repliable instanceof Message ? repliable.author : repliable.user;

    const locale = userData ? await fetchUserLocale(userData) : 'en';
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:continue', [author.id]).toString())
        .setLabel('Continue')
        .setStyle(ButtonStyle.Success),
    );

    const welcomeMsg = {
      content: t('rules.welcome', locale, {
        emoji: getEmoji('wave_anim', repliable.client),
        user: author.username,
      }),
      components: [buttons],
    };

    if (repliable instanceof Message) {
      await repliable.reply(welcomeMsg);
    }
    else if (repliable.isRepliable()) {
      await repliable.reply({ ...welcomeMsg, flags: ['Ephemeral'] });
    }
  }
  catch (e) {
    Logger.error(e);
  }
};

export default class RulesScreeningInteraction {
  @RegisterInteractionHandler('rulesScreen', 'continue')
  async inactiveConnect(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId] = customId.args;

    if (interaction.user.id !== userId) {
      await interaction.reply({
        embeds: [
          new InfoEmbed({
            description: t('errors.notYourAction', 'en', {
              emoji: getEmoji('x_icon', interaction.client),
            }),
          }),
        ],
        flags: ['Ephemeral'],
      });
      return;
    }

    const userData = await fetchUserData(userId);

    if (this.hasAlreadyAccepted(interaction, userData)) return;

    await this.showRules(interaction, userData).catch(handleError);
  }

  @RegisterInteractionHandler('rulesScreen')
  async handleRulesResponse(interaction: ButtonInteraction) {
    await interaction.deferUpdate();
    const customId = CustomID.parseCustomId(interaction.customId);

    if (customId.suffix === 'accept') {
      const locale = await fetchUserLocale(interaction.user.id);

      const { success } = await this.acceptRules(interaction);
      if (!success) return;

      const embed = new InfoEmbed().setDescription(
        t('rules.accepted', locale, {
          emoji: getEmoji('tick_icon', interaction.client),
          support_invite: Constants.Links.SupportInvite,
          donateLink: Constants.Links.Donate,
        }),
      );

      await interaction.editReply({ embeds: [embed], components: [] });
    }
    else {
      await interaction.deleteReply();
    }
  }

  private async showRules(interaction: ButtonInteraction, userData: UserData | null) {
    const locale = userData ? await fetchUserLocale(userData) : 'en';
    const rulesEmbed = new InfoEmbed()
      .setDescription(
        t('rules.rules', locale, {
          emoji: getEmoji('rules_icon', interaction.client),
        }),
      )
      .setColor(Constants.Colors.interchat);

    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:accept').toString())
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(new CustomID('rulesScreen:decline').toString())
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );

    await interaction
      .reply({
        embeds: [rulesEmbed],
        components: [components],
        flags: ['Ephemeral'],
      })
      .catch((e) =>
        // TODO: this is temporary. Used only for debugging an error in v4.3.0
        handleError(e, { repliable: interaction, comment: 'Failed to show rules. Try again.' }),
      );
  }

  private async acceptRules(interaction: ButtonInteraction) {
    const userService = new UserDbService();
    const userData = await userService.getUser(interaction.user.id); // fetch user data again to ensure it's up to date

    if (this.hasAlreadyAccepted(interaction, userData)) return { success: false };

    await userService.upsertUser(interaction.user.id, { acceptedRules: true });

    return { success: true };
  }

  private hasAlreadyAccepted(interaction: ButtonInteraction, userData: UserData | null) {
    if (!userData?.acceptedRules) return false;
    const embed = new InfoEmbed().setDescription(
      t('rules.alreadyAccepted', userData.locale as supportedLocaleCodes, {
        emoji: getEmoji('tick_icon', interaction.client),
      }),
    );

    const replyMethod = getReplyMethod(interaction);
    interaction[replyMethod]({ embeds: [embed], flags: ['Ephemeral'] }).catch(handleError);

    return true;
  }
}
