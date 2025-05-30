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

import type BaseCommand from '#src/core/BaseCommand.js';
import BaseEventListener from '#src/core/BaseEventListener.js';
import { showRulesScreening } from '#src/interactions/RulesScreening.js';
import { openInboxButton } from '#src/interactions/ShowInboxButton.js';
import { executeCommand, resolveCommand } from '#src/utils/CommandUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID, type ParsedCustomId } from '#utils/CustomID.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import {
  checkIfStaff,
  createUnreadDevAlertEmbed,
  fetchUserData,
  fetchUserLocale,
  handleError,
  hasUnreadDevAlert,
} from '#utils/Utils.js';
import type { User as DbUser } from '#src/generated/prisma/client/client.js';
import type {
  AutocompleteInteraction,
  CacheType,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  Interaction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createComponentContext } from '#src/utils/ContextUtils.js';
import BanManager from '#src/managers/UserBanManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';

export default class InteractionCreate extends BaseEventListener<'interactionCreate'> {
  readonly name = 'interactionCreate';

  async execute(interaction: Interaction<CacheType>) {
    try {
      const preCheckResult = await this.performPreChecks(interaction);
      if (!preCheckResult.shouldContinue) return;
      await this.handleInteraction(interaction, preCheckResult.dbUser).catch((e) => {
        handleError(e, { repliable: interaction });
      });

      await this.showDevAlertIfAny(interaction, preCheckResult.dbUser);
    }
    catch (e) {
      handleError(e, { repliable: interaction });
    }
  }

  private async showDevAlertIfAny(interaction: Interaction, dbUser: DbUser | null) {
    if (!interaction.isRepliable() || !interaction.replied || !dbUser) return;

    const shouldShow = await hasUnreadDevAlert(dbUser);
    if (!shouldShow) return;

    await interaction
      .followUp({
        embeds: [createUnreadDevAlertEmbed(this.getEmoji('info_icon'))],
        components: [openInboxButton],
        flags: ['Ephemeral'],
      })
      .catch(() => null);
  }

  private async performPreChecks(interaction: Interaction) {
    if (this.isInMaintenance(interaction)) {
      return { shouldContinue: false, dbUser: null };
    }

    const dbUser = await fetchUserData(interaction.user.id);

    if (await this.isUserBanned(interaction, dbUser ?? undefined)) {
      return { shouldContinue: false, dbUser: null };
    }

    if (this.shouldShowRules(interaction, dbUser) && interaction.isRepliable()) {
      await showRulesScreening(interaction, dbUser);
      return { shouldContinue: false, dbUser: null };
    }

    return { shouldContinue: true, dbUser };
  }

  private async handleInteraction(interaction: Interaction, dbUser: DbUser | null) {
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await this.handleComponentOrModal(interaction, dbUser);
      return;
    }

    await this.handleCommand(interaction);
  }

  private async handleCommand(
    interaction:
      | ChatInputCommandInteraction
      | ContextMenuCommandInteraction
      | AutocompleteInteraction,
  ) {
    const resolved = resolveCommand(interaction);
    if (!resolved.command) return;

    if (resolved.command.staffOnly && !checkIfStaff(interaction.user.id)) return;

    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(resolved.command, interaction);
      return;
    }

    await executeCommand(interaction, resolved);
  }

  private async handleAutocomplete(
    command: BaseCommand | undefined,
    interaction: AutocompleteInteraction,
  ) {
    if (command?.autocomplete) {
      await command.autocomplete(interaction);
    }
  }

  private async handleComponentOrModal(
    interaction: ModalSubmitInteraction | MessageComponentInteraction,
    dbUser: DbUser | null,
  ) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const handler = this.getInteractionHandler(interaction, customId);

    if (await this.isExpiredInteraction(interaction, customId, dbUser)) {
      return;
    }

    if (handler) {
      const context = createComponentContext(interaction);
      await handler(context, interaction);
    }
  }

  private getInteractionHandler(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    customId: ParsedCustomId,
  ) {
    const { interactions } = interaction.client;
    const customIdSuffix = customId.suffix ? `:${customId.suffix}` : '';
    return (
      interactions.get(`${customId.prefix}${customIdSuffix}`) ?? interactions.get(customId.prefix)
    );
  }

  private async isExpiredInteraction(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    customId: ParsedCustomId,
    dbUser: DbUser | null,
  ) {
    if (!customId.expiry || customId.expiry >= Date.now()) {
      return false;
    }

    const locale = dbUser ? await fetchUserLocale(dbUser) : 'en';
    const embed = new InfoEmbed({
      description: t('errors.notUsable', locale, {
        emoji: this.getEmoji('slash'),
      }),
    });

    await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    return true;
  }

  private shouldShowRules(interaction: Interaction, dbUser: DbUser | null) {
    const isRulesScreenButton =
      interaction.isButton() &&
      CustomID.parseCustomId(interaction.customId).prefix === 'rulesScreen';

    return !dbUser?.acceptedRules && !isRulesScreenButton;
  }

  private isInMaintenance(interaction: Interaction) {
    if (!interaction.client.cluster.maintenance || !interaction.isRepliable()) {
      return false;
    }

    interaction
      .reply({
        content: `${this.getEmoji('slash')} The bot is currently undergoing maintenance. Please try again later.`,
        flags: ['Ephemeral'],
      })
      .catch(() => null);
    return true;
  }

  private async isUserBanned(interaction: Interaction, dbUser?: DbUser) {
    const banManager = new BanManager();
    const banCheck = await banManager.isUserBanned(interaction.user.id);
    if (banCheck.isBanned && banCheck.ban) {
      if (interaction.isRepliable() && dbUser) {
        const durationText = banCheck.ban.type === 'PERMANENT'
          ? 'permanently'
          : banCheck.ban.expiresAt
            ? `until <t:${Math.floor(banCheck.ban.expiresAt.getTime() / 1000)}:F>`
            : 'permanently';

        await interaction.reply({
          content: `${this.getEmoji('x_icon')} **You are banned from using InterChat**\n\n**Reason:** ${banCheck.ban.reason}\n**Duration:** ${durationText}\n**Ban ID:** \`${banCheck.ban.id}\`\n\nIf you believe this ban is unjustified, you can appeal at ${Constants.Links.SupportInvite}`,
          flags: ['Ephemeral'],
        });
      }
      return true;
    }

    // Check for server ban if in a guild
    if (interaction.guild) {
      const serverBanManager = new ServerBanManager();
      const serverBanCheck = await serverBanManager.isServerBanned(interaction.guild.id);

      if (serverBanCheck.isBanned && serverBanCheck.ban) {
        if (interaction.isRepliable() && dbUser) {
          const durationText = serverBanCheck.ban.type === 'PERMANENT'
            ? 'permanently'
            : serverBanCheck.ban.expiresAt
              ? `until <t:${Math.floor(new Date(serverBanCheck.ban.expiresAt).getTime() / 1000)}:F>`
              : 'permanently';

          await interaction.reply({
            content: `${this.getEmoji('x_icon')} **This server is banned from using InterChat**\n\n**Reason:** ${serverBanCheck.ban.reason}\n**Duration:** ${durationText}\n**Ban ID:** \`${serverBanCheck.ban.id}\`\n\nServer administrators can appeal at ${Constants.Links.SupportInvite}`,
            flags: ['Ephemeral'],
          });
        }
        return true;
      }
    }

    return false;
  }
}
