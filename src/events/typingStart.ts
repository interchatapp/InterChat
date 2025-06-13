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

import BaseEventListener from '#src/core/BaseEventListener.js';
import { CallService } from '#src/services/CallService.js';
import { RedisKeys } from '#src/utils/Constants.js';
import getRedis from '#src/utils/Redis.js';
import Logger from '#utils/Logger.js';
import { type Typing } from 'discord.js';

export default class TypingStart extends BaseEventListener<'typingStart'> {
  readonly name = 'typingStart';

  async execute(typing: Typing) {
    try {
      // Only handle typing in guild channels
      if (!typing.inGuild() || typing.user.bot || typing.user.system) return;

      const callService = new CallService(typing.client);
      const activeCall = await callService.getActiveCallData(typing.channel.id);

      // Only process typing if this channel is in an active call
      if (!activeCall) return;

      // Rate limit typing indicators to prevent spam
      const redis = getRedis();
      const rateLimitKey = `${RedisKeys.CallTypingRateLimit}:${typing.user.id}:${typing.channel.id}`;
      const isRateLimited = await redis.exists(rateLimitKey);

      if (isRateLimited) return;

      // Set rate limit for 3 seconds (increased from 2 for better UX)
      await redis.set(rateLimitKey, '1', 'EX', 3);

      // Find the other participant channels in the SAME call
      const otherParticipant = activeCall.participants.find(
        (p) => p.channelId !== typing.channel.id,
      );

      if (!otherParticipant) return;

      // Send typing indicators to other participant in the call
      try {
        // Fetch the channel and trigger typing indicator directly
        const channel = await typing.client.channels.fetch(otherParticipant.channelId);
        if (channel?.isTextBased() && 'sendTyping' in channel) {
          // Use Discord's native typing indicator instead of webhook messages
          await channel.sendTyping();

          // Store typing state for potential cleanup
          const typingStateKey = `${RedisKeys.CallTypingRateLimit}:state:${otherParticipant.channelId}:${typing.user.id}`;
          await redis.set(typingStateKey, typing.user.username ?? 'Unknown', 'EX', 10);
        }
      }
      catch (error) {
        Logger.debug(`Failed to send typing indicator to channel ${otherParticipant.channelId}:`, error);

        // Fallback to webhook-based typing indicator if direct typing fails
        try {
          const { BroadcastService } = await import('#src/services/BroadcastService.js');

          // Send a more subtle typing indicator message
          await BroadcastService.sendMessage(otherParticipant.webhookUrl, {
            content: `💭 *${typing.user.username} is typing...*`,
            username: 'InterChat Calls',
            avatarURL: typing.client.user?.displayAvatarURL(),
            allowedMentions: { parse: [] },
          }).then(async (sentMessage) => {
            // Delete the typing message after 4 seconds
            if (sentMessage?.message?.id) {
              setTimeout(async () => {
                try {
                  const channel = await typing.client.channels.fetch(otherParticipant.channelId);
                  if (channel?.isTextBased() && sentMessage.message) {
                    const message = await channel.messages.fetch(sentMessage.message.id);
                    await message.delete();
                  }
                }
                catch (_deleteError) {
                  // Ignore deletion errors
                }
              }, 4000);
            }
          });
        }
        catch (fallbackError) {
          Logger.debug(`Fallback typing indicator also failed for channel ${otherParticipant.channelId}:`, fallbackError);
        }
      }

      Logger.debug(`Relayed typing indicator from ${typing.user.username} in call ${activeCall.callId}`);
    }
    catch (error) {
      Logger.error('Error handling typing start event:', error);
    }
  }
}
