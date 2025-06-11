import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CallService } from '#src/services/CallService.js';
import { ReputationService } from '#src/services/ReputationService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import getRedis from '#src/utils/Redis.js';

export default class CallRatingHandler {
  @RegisterInteractionHandler('rate_call')
  async execute(ctx: ComponentContext) {
    const {
      suffix: rating,
      args: [callId],
    } = ctx.customId;
    const locale = await ctx.getLocale();
    const x_icon = getEmoji('x_icon', ctx.client);

    if (!callId) {
      await ctx.reply({
        content: t('calls.rating.invalidButton', locale, { emoji: x_icon }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

    if (!callData) {
      await ctx.reply({
        content: t('calls.rating.noCallData', locale, { emoji: x_icon }),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Check if user already rated this call
    const ratingKey = `call:rating:${callData.callId}:${ctx.user.id}`;
    const hasRated = await getRedis().get(ratingKey);

    if (hasRated) {
      await ctx.reply({
        content: t('calls.rating.alreadyRated', locale, { emoji: x_icon }),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Find the other channel's participants
    const otherChannelParticipants = callData.participants.find(
      (p) => p.channelId !== ctx.channelId,
    );

    if (!otherChannelParticipants || otherChannelParticipants.users.size === 0) {
      await ctx.reply({
        content: t('calls.rating.noParticipants', locale, { emoji: x_icon }),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Handle the rating
    const reputationService = new ReputationService();
    const ratingValue = rating === 'like' ? 1 : -1;

    for (const userId of otherChannelParticipants.users) {
      await reputationService.addRating(userId, ratingValue, {
        callId: callData.callId,
        raterId: ctx.user.id,
      });
    }

    // Mark this call as rated by this user
    await getRedis().set(ratingKey, '1', 'EX', 3600 * 24); // 24 hour expiry

    const tick_icon = getEmoji('tick_icon', ctx.client);
    const participantCount = otherChannelParticipants.users.size;

    await ctx.reply({
      content: `${tick_icon} ${t('calls.rating.success', locale, {
        type: rating === 'like' ? 'positive' : 'negative',
        count: participantCount.toString(),
        plural: participantCount > 1 ? 's' : '',
      })}`,
      flags: ['Ephemeral'],
    });
  }
}
