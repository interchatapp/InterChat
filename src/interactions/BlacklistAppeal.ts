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
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type { AppealStatus } from '#src/generated/prisma/client/index.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import InfractionManager from '#src/managers/InfractionManager.js';

import { HubService } from '#src/services/HubService.js';
import Constants from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { CustomID } from '#utils/CustomID.js';
import { ErrorEmbed, InfoEmbed } from '#utils/EmbedUtils.js';
import Logger from '#utils/Logger.js';
import { msToReadable } from '#utils/Utils.js';
import logAppeals from '#utils/hub/logger/Appeals.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ModalActionRowComponentBuilder,
  ModalBuilder,
  type Snowflake,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const buildAppealSubmitButton = (type: 'user' | 'server', hubId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID('appealSubmit:button', [type, hubId]).toString())
      .setLabel('Appeal')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
  );


export const buildAppealSubmitModal = (type: 'server' | 'user', hubId: string) => {
  const questions: [string, string, TextInputStyle, boolean, string?][] = [
    ['blacklistedFor', 'Why were you blacklisted?', TextInputStyle.Paragraph, true],
    [
      'unblacklistReason',
      'Appeal Reason',
      TextInputStyle.Paragraph,
      true,
      `Why do you think ${type === 'server' ? 'this server' : 'you'} should be unblacklisted?`,
    ],
    ['extras', 'Anything else you would like to add?', TextInputStyle.Paragraph, false],
  ];

  const actionRows = questions.map(([fieldCustomId, label, style, required, placeholder]) => {
    const input = new TextInputBuilder()
      .setCustomId(fieldCustomId)
      .setLabel(label)
      .setStyle(style)
      .setMinLength(20)
      .setRequired(required);

    if (placeholder) input.setPlaceholder(placeholder);
    return new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  });

  return new ModalBuilder()
    .setTitle('Blacklist Appeal')
    .setCustomId(new CustomID('appealSubmit:modal', [type, hubId]).toString())
    .addComponents(actionRows);
};

export default class AppealInteraction {
  @RegisterInteractionHandler('appealSubmit', 'button')
  async appealSubmitButton(ctx: ComponentContext): Promise<void> {
    const [type, hubId] = ctx.customId.args as ['user' | 'server', string];

    const appealChannelId = await this.validateBlacklistAppealLogConfig(ctx, hubId);
    const { passedCheck: passed } = await this.checkBlacklistOrSendError(ctx, hubId, type);
    if (!appealChannelId || !passed) return;

    if (
      type === 'server' &&
      (!ctx.inGuild() ||
        !ctx.member?.permissionsIn(ctx.channelId).has('ManageMessages', true))
    ) {
      const embed = new InfoEmbed().setDescription(
        'You do not have the required permissions in this channel to appeal this blacklist.',
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const modal = buildAppealSubmitModal(type, hubId);
    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('appealSubmit', 'modal')
  async appealSubmitModal(ctx: ComponentContext): Promise<void> {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const [type, hubId] = ctx.customId.args as ['user' | 'server', string];

    const appealsConfig = await this.validateBlacklistAppealLogConfig(ctx, hubId);
    if (!appealsConfig) return;

    const { passedCheck } = await this.checkBlacklistOrSendError(ctx, hubId, type);
    if (!passedCheck) return;

    const { appealsChannelId, appealsRoleId } = appealsConfig;
    if (!appealsChannelId) return;


    let appealIconUrl: string | null;
    let appealName: string | undefined;
    let appealTargetId: Snowflake;
    if (type === 'server') {
      appealIconUrl = ctx.guild?.iconURL() ?? null;
      appealName = ctx.guild?.name ?? undefined;
      appealTargetId = ctx.guildId as string;
    }
    else {
      appealIconUrl = ctx.user.displayAvatarURL();
      appealName = ctx.user.username;
      appealTargetId = ctx.user.id;
    }

    const infractionManager = new InfractionManager(type, appealTargetId);
    const infraction = await infractionManager.fetchInfraction('BLACKLIST', hubId);

    if (!infraction) {
      const embed = new ErrorEmbed(ctx.client).setDescription(
        'Failed to update infraction with appeal information.',
      );
      await ctx.editReply({ embeds: [embed] });
      return;
    }

    // Create a new appeal entry
    const appealReason = ctx.getModalFieldValue('unblacklistReason');
    await db.appeal.create({
      data: {
        infractionId: infraction.id,
        userId: ctx.user.id,
        reason: appealReason ?? 'No reason provided.',
        status: 'PENDING',
      },
    });

    await logAppeals(type, hubId, ctx.user, {
      appealsChannelId,
      appealsRoleId,
      appealName,
      appealTargetId,
      appealIconUrl: appealIconUrl ?? undefined,
      fields: {
        blacklistedFor: ctx.getModalFieldValue('blacklistedFor') ?? 'None provided.',
        unblacklistReason: appealReason ?? 'None provided.',
        extras: ctx.getModalFieldValue('extras') ?? 'None provided.',
      },
    });

    const embed = new InfoEmbed().setTitle('📝 Appeal Sent').setDescription(
      `Your blacklist appeal has been submitted. You will be notified via DM when the appeal is reviewed.

      ${getEmoji('zap_icon', ctx.client)} **View your appeal & status in the dashboard:** ${Constants.Links.Website}/dashboard/my-appeals
      `,
    );

    await ctx.editReply({ embeds: [embed] });
  }

  @RegisterInteractionHandler('appealReview')
  async appealReviewButton(ctx: ComponentContext): Promise<void> {
    const [type, hubId, targetId] = ctx.customId.args as ['user' | 'server', string, Snowflake];

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('disabledAppealReview')
        .setDisabled(true)
        .setLabel(
          `${ctx.customId.suffix === 'approve' ? 'Approved' : 'Rejected'} by @${ctx.user.username}`,
        )
        .setStyle(ctx.customId.suffix === 'approve' ? ButtonStyle.Success : ButtonStyle.Danger),
    );

    await ctx.editReply({ components: [button] });

    const blacklistManager = new BlacklistManager(type, targetId);
    const blacklist = await blacklistManager.fetchBlacklist(hubId, { appeal: true });
    if (!blacklist) return;

    // Update the appeal status
    const newStatus: AppealStatus = ctx.customId.suffix === 'approve' ? 'ACCEPTED' : 'REJECTED';

    // Find the latest appeal for this infraction
    const latestAppeal = await db.appeal.findFirst({
      where: {
        infractionId: blacklist.id,
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Update the appeal status if found
    if (latestAppeal) {
      await db.appeal.update({
        where: { id: latestAppeal.id },
        data: { status: newStatus },
      });
    }

    // If approved, remove the blacklist
    if (ctx.customId.suffix === 'approve') await blacklistManager.removeBlacklist(hubId);

    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(hubId);

    const appealer = blacklist.appeal
      ? await ctx.client.users.fetch(blacklist.appeal.userId).catch(() => null)
      : null;
    const appealTarget =
      type === 'user' ? `user \`${appealer?.tag}\`` : `server \`${blacklist.serverName}\``;
    const extraServerSteps =
      type === 'server'
        ? `You can re-join the hub by running \`/connect hub:${hub?.data.name}\`.`
        : '';

    // TODO: localize
    const approvalStatus = ctx.customId.suffix === 'approve' ? 'appealed 🎉' : 'rejected';
    const message = `
      ### Blacklist Appeal Review
      Your blacklist appeal for ${appealTarget} in the hub **${hub?.data.name}** has been ${approvalStatus}.\n${extraServerSteps}

      ${ctx.client.emojis.cache.find((e) => e.name === 'wand_icon')} **Tip:** Manage all your appeals through our [dashboard](${Constants.Links.Website}/dashboard/my-appeals).
    `;

    const embed = new EmbedBuilder()
      .setColor(approvalStatus === 'rejected' ? 'Red' : 'Green')
      .setDescription(message);

    if (!appealer) {
      Logger.error(`Failed to fetch appealer for blacklist appeal review: ${targetId}`);
      await ctx.reply({
        content: 'I couldn\'t DM appeal approval to appealer.',
        flags: ['Ephemeral'],
      });
      return;
    }

    await appealer
      .send({ embeds: [embed] })
      .catch((e) => Logger.error(`Failed to DM appeal approval to ${appealer.tag}`, e));
  }

  async validateBlacklistAppealLogConfig(ctx: ComponentContext, hubId: string) {
    const hubLogManager = await HubLogManager.create(hubId);
    if (!hubLogManager.config.appealsChannelId) {
      const embed = new InfoEmbed().setDescription('Blacklist appeals are disabled in this hub.');

      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return null;
    }

    return hubLogManager.config;
  }

  async checkBlacklistOrSendError(
    ctx: ComponentContext,
    hubId: string,
    type: 'user' | 'server',
  ): Promise<{ passedCheck: boolean }> {
    const blacklistManager = new BlacklistManager(
      type,
      type === 'user' ? ctx.user.id : (ctx.guildId as string),
    );

    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(hubId);

    // Get the active blacklist
    const blacklist = await blacklistManager.fetchBlacklist(hubId);
    if (!blacklist) {
      const embed = new ErrorEmbed(ctx.client).setDescription(
        'You cannot appeal a blacklist that does not exist.',
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return { passedCheck: false };
    }

    // Calculate appeal cooldown
    const sevenDays = 60 * 60 * 24 * 7 * 1000;
    const appealCooldown = hub?.data.appealCooldownHours
      ? hub.data.appealCooldownHours * (60 * 60 * 1000)
      : sevenDays;

    // Find the latest appeal for this infraction
    const latestAppeal = await db.appeal.findFirst({
      where: {
        infractionId: blacklist.id,
        userId: ctx.user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Check if the latest appeal is within the cooldown period
    if (latestAppeal && latestAppeal.createdAt.getTime() + appealCooldown > Date.now()) {
      const embed = new ErrorEmbed(ctx.client).setDescription(
        `You can only appeal once every **${msToReadable(appealCooldown, false)}**.`,
      );

      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return { passedCheck: false };
    }

    return { passedCheck: true };
  }
}
