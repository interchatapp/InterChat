import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CallService } from '#src/services/CallService.js';
import { ReputationService } from '#src/services/ReputationService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import getRedis from '#src/utils/Redis.js';

export default class CallRatingHandler {
  @RegisterInteractionHandler('rate_call')
  async execute(ctx: ComponentContext) {
    const { suffix: rating, args: [callId] } = ctx.customId;

    const x_icon = getEmoji('x_icon', ctx.client);

    if (!callId) {
      await ctx.reply({
        content: `${x_icon} Invalid rating button. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

    if (!callData) {
      await ctx.reply({
        content: `${x_icon} Unable to find call data. The call might have ended too long ago.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Check if user already rated this call
    const ratingKey = `call:rating:${callData.callId}:${ctx.user.id}`;
    const hasRated = await getRedis().get(ratingKey);

    if (hasRated) {
      await ctx.reply({
        content: `${x_icon} You have already rated this call.`,
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
        content: `${x_icon} Unable to find participants from the other channel.`,
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

    await ctx.reply({
      content: `${tick_icon} Thanks for rating! Your **${rating === 'like' ? 'positive' : 'negative'}** feedback has been recorded for ${otherChannelParticipants.users.size} participant${otherChannelParticipants.users.size > 1 ? 's' : ''}.`,
      flags: ['Ephemeral'],
    });
  }
}
