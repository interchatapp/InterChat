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

import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import InfractionManager from '#src/managers/InfractionManager.js';

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type Snowflake,
  type User,
} from 'discord.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { CustomID } from '#utils/CustomID.js';
import { ErrorEmbed, InfoEmbed } from '#utils/EmbedUtils.js';
import Logger from '#utils/Logger.js';
import { getReplyMethod, msToReadable } from '#utils/Utils.js';
import logAppeals from '#utils/hub/logger/Appeals.js';
import { buildAppealSubmitModal } from '#utils/moderation/blacklistUtils.js';

export const buildAppealSubmitButton = (type: 'user' | 'server', hubId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('appealSubmit:button', [type, hubId]).toString())
      .setLabel('Appeal')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
  );

export default class AppealInteraction {
  @RegisterInteractionHandler('appealSubmit', 'button')
  async appealSubmitButton(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [type, hubId] = customId.args as ['user' | 'server', string];

    const appealChannelId = await this.validateBlacklistAppealLogConfig(interaction, hubId);
    const { passedCheck: passed } = await this.checkBlacklistOrSendError(interaction, hubId, type);
    if (!appealChannelId || !passed) return;

    if (
      type === 'server' &&
      (!interaction.inCachedGuild() ||
        !interaction.channel?.permissionsFor(interaction.member).has('ManageMessages', true))
    ) {
      const embed = new InfoEmbed().setDescription(
        'You do not have the required permissions in this channel to appeal this blacklist.',
      );
      await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const modal = buildAppealSubmitModal(type, hubId);
    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler('appealSubmit', 'modal')
  async appealSubmitModal(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const customId = CustomID.parseCustomId(interaction.customId);
    const [type, hubId] = customId.args as ['user' | 'server', string];

    const appealsConfig = await this.validateBlacklistAppealLogConfig(interaction, hubId);
    if (!appealsConfig) return;

    const { passedCheck } = await this.checkBlacklistOrSendError(interaction, hubId, type);
    if (!passedCheck) return;

    const { channelId: appealsChannelId, roleId: appealsRoleId } = appealsConfig;

    let appealIconUrl: string | null;
    let appealName: string | undefined;
    let appealTargetId: Snowflake;
    if (type === 'server') {
      appealIconUrl = interaction.guild?.iconURL() ?? null;
      appealName = interaction.guild?.name ?? undefined;
      appealTargetId = interaction.guildId as string;
    }
    else {
      appealIconUrl = interaction.user.displayAvatarURL();
      appealName = interaction.user.username;
      appealTargetId = interaction.user.id;
    }

    await new InfractionManager(type, appealTargetId).updateInfraction(
      { type: 'BLACKLIST', hubId, status: 'ACTIVE' },
      { appealedBy: interaction.user.id, appealedAt: new Date() },
    );

    await logAppeals(type, hubId, interaction.user, {
      appealsChannelId,
      appealsRoleId,
      appealName,
      appealTargetId,
      appealIconUrl: appealIconUrl ?? undefined,
      fields: {
        blacklistedFor: interaction.fields.getTextInputValue('blacklistedFor'),
        unblacklistReason: interaction.fields.getTextInputValue('unblacklistReason'),
        extras: interaction.fields.getTextInputValue('extras'),
      },
    });

    const embed = new InfoEmbed()
      .setTitle('📝 Appeal Sent')
      .setDescription(
        'Your blacklist appeal has been submitted. You will be notified via DM when the appeal is reviewed.',
      );

    await interaction.editReply({ embeds: [embed] });
  }

  @RegisterInteractionHandler('appealReview')
  async appealReviewButton(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [type, hubId, targetId] = customId.args as ['user' | 'server', string, Snowflake];

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('disabledAppealReview')
        .setDisabled(true)
        .setLabel(
          `${customId.suffix === 'approve' ? 'Approved' : 'Rejected'} by @${interaction.user.username}`,
        )
        .setStyle(customId.suffix === 'approve' ? ButtonStyle.Success : ButtonStyle.Danger),
    );

    await interaction.update({ components: [button] });

    const blacklistManager =
      type === 'user'
        ? new BlacklistManager('user', targetId)
        : new BlacklistManager('server', targetId);

    const blacklist = await blacklistManager.fetchBlacklist(hubId);
    if (!blacklist) return;

    if (customId.suffix === 'approve') await blacklistManager.removeBlacklist(hubId);
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(hubId);

    let appealer: User;
    let appealTarget: string;
    let extraServerSteps = '';
    if (type === 'user') {
      appealer = await interaction.client.users.fetch(targetId);
      appealTarget = `user \`${appealer.username}\``;
    }
    else {
      appealTarget =
        'serverName' in blacklist ? `server \`${blacklist.serverName}\`` : 'your server';
      appealer =
        'appealerUserId' in blacklist
          ? await interaction.client.users.fetch(blacklist.appealerUserId as string)
          : await interaction.client.users.fetch(targetId);
      extraServerSteps = `You can re-join the hub by running \`/hub join hub:${hub?.data.name}\`.`;
    }

    const approvalStatus = customId.suffix === 'approve' ? 'appealed 🎉' : 'rejected';
    const message = `
      ### Blacklist Appeal Review
      Your blacklist appeal for ${appealTarget} in the hub **${hub?.data.name}** has been ${approvalStatus}. ${extraServerSteps}
    `;

    const embed = new EmbedBuilder()
      .setColor(approvalStatus === 'rejected' ? 'Red' : 'Green')
      .setDescription(message);

    await appealer
      .send({ embeds: [embed] })
      .catch((e) => Logger.error(`Failed to DM appeal approval to ${appealer.tag}`, e));
  }

  async validateBlacklistAppealLogConfig(interaction: RepliableInteraction, hubId: string) {
    const hubLogManager = await HubLogManager.create(hubId);
    if (!hubLogManager.config.appeals?.channelId) {
      const embed = new InfoEmbed().setDescription('Blacklist appeals are disabled in this hub.');
      const replyMethod = getReplyMethod(interaction);

      await interaction[replyMethod]({ embeds: [embed], flags: ['Ephemeral'] });
      return null;
    }

    return hubLogManager.config.appeals;
  }

  async checkBlacklistOrSendError(
    interaction: RepliableInteraction,
    hubId: string,
    type: 'user' | 'server',
  ): Promise<{ passedCheck: boolean }> {
    const blacklistManager = new BlacklistManager(
      type,
      type === 'user' ? interaction.user.id : (interaction.guildId as string),
    );

    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(hubId);
    const allInfractions = await blacklistManager.infractions.getHubInfractions(hubId, {
      type: 'BLACKLIST',
    });

    const sevenDays = 60 * 60 * 24 * 7 * 1000;
    const appealCooldown = hub?.data.appealCooldownHours
      ? hub.data.appealCooldownHours * (60 * 60 * 1000)
      : sevenDays;

    const lastAppealed = allInfractions.find(
      (i) => i.appealedAt && i.appealedAt.getTime() + appealCooldown > Date.now(),
    );

    if (lastAppealed?.appealedAt) {
      const embed = new ErrorEmbed(interaction.client).setDescription(
        `You can only appeal once every **${msToReadable(appealCooldown, false)}**.`,
      );

      const replyMethod = getReplyMethod(interaction);
      await interaction[replyMethod]({ embeds: [embed], flags: ['Ephemeral'] });
      return { passedCheck: false };
    }

    // if last appeal was less than 7 days ago

    const blacklist = await blacklistManager.fetchBlacklist(hubId);
    if (!blacklist) {
      const embed = new ErrorEmbed(interaction.client).setDescription(
        'You cannot appeal a blacklist that does not exist.',
      );
      await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return { passedCheck: false };
    }

    return { passedCheck: true };
  }
}
