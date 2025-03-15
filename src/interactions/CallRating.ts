import { ButtonInteraction } from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { ReputationService } from '#src/services/ReputationService.js';
import { CallService } from '#src/services/CallService.js';
import { CustomID } from '#src/utils/CustomID.js';
import getRedis from '#src/utils/Redis.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';

export default class CallRatingHandler {
  @RegisterInteractionHandler('rate_call')
  async execute(interaction: ButtonInteraction) {
    const { suffix: rating, args: [callId] } = CustomID.parseCustomId(interaction.customId);

    const x_icon = getEmoji('x_icon', interaction.client);

    if (!callId) {
      await interaction.reply({
        content: `${x_icon} Invalid rating button. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const callService = new CallService(interaction.client);
    const callData = await callService.getEndedCallData(callId);

    if (!callData) {
      await interaction.reply({
        content: `${x_icon} Unable to find call data. The call might have ended too long ago.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Check if user already rated this call
    const ratingKey = `call:rating:${callData.callId}:${interaction.user.id}`;
    const hasRated = await getRedis().get(ratingKey);

    if (hasRated) {
      await interaction.reply({
        content: `${x_icon} You have already rated this call.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Find the other channel's participants
    const otherChannelParticipants = callData.participants.find(
      (p) => p.channelId !== interaction.channelId,
    );

    if (!otherChannelParticipants || otherChannelParticipants.users.size === 0) {
      await interaction.reply({
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
        raterId: interaction.user.id,
      });
    }

    // Mark this call as rated by this user
    await getRedis().set(ratingKey, '1', 'EX', 3600 * 24); // 24 hour expiry

    const tick_icon = getEmoji('tick_icon', interaction.client);

    await interaction.reply({
      content: `${tick_icon} Thanks for rating! Your **${rating === 'like' ? 'positive' : 'negative'}** feedback has been recorded for ${otherChannelParticipants.users.size} participant${otherChannelParticipants.users.size > 1 ? 's' : ''}.`,
      flags: ['Ephemeral'],
    });
  }
}
