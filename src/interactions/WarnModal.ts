import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { buildModPanel } from '#src/interactions/ModPanel.js';
import { t } from '#src/utils/Locale.js';
import { warnUser } from '#src/utils/moderation/warnUtils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';

export default class WarnModalHandler {
  /**
   * ### WARNING:
   * This function does NOT check if the user is hub mod. It is assumed that
   * the interaction will only be called by `interactions/ModPanel.ts`,
   * and that it has already done the necessary checks.
   */
  @RegisterInteractionHandler('warnModal')
  async handleModal(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.isModalSubmit()) return;

    const [userId, hubId] = ctx.customId.args;
    const reason = ctx.getModalFieldValue('reason');

    await warnUser({
      userId,
      hubId,
      reason,
      moderatorId: ctx.user.id,
      client: ctx.client,
    });

    const originalMsg = await findOriginalMessage(userId);
    if (!originalMsg) {
      return;
    }

    await ctx.reply({
      content: t('warn.success', await ctx.getLocale(), {
        emoji: ctx.getEmoji('tick_icon'),
        name: (await ctx.client.users.fetch(userId)).username,
      }),
      flags: ['Ephemeral'],
    });

    const { container, buttons } = await buildModPanel(
      originalMsg,
      ctx.user,
      await ctx.getLocale(),
    );
    await ctx.editReply({ components: [container, ...buttons], flags: ['IsComponentsV2'] });
  }
}
