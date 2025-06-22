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

import Logger from '#src/utils/Logger.js';
import { type Message } from 'discord.js';
import { BroadcastService } from './BroadcastService.js';
import { CallDatabaseService } from './CallDatabaseService.js';
import type { ActiveCall, CallParticipant } from '#src/types/CallTypes.js';

/**
 * Service for handling reply messages in calls with enhanced container components
 */
export class CallReplyService {
  private readonly callDbService: CallDatabaseService;

  constructor() {
    this.callDbService = new CallDatabaseService();
  }

  /**
   * Processes a reply message in a call and formats it with container components
   */
  async processCallReply(
    message: Message<true>,
    activeCall: ActiveCall,
    referencedMessage?: Message,
  ): Promise<void> {
    try {
      // Find the participant for this channel
      const currentParticipant = activeCall.participants.find(
        (p: CallParticipant) => p.channelId === message.channel.id,
      );

      if (!currentParticipant) {
        Logger.warn(
          `No participant found for channel ${message.channel.id} in call ${activeCall.id}`,
        );
        return;
      }

      // Get other participants to send the reply to
      const otherParticipants = activeCall.participants.filter(
        (p: CallParticipant) => p.channelId !== message.channel.id,
      );

      if (otherParticipants.length === 0) {
        Logger.debug(`No other participants in call ${activeCall.id}`);
        return;
      }

      // Create reply context information
      const replyContext = await this.createReplyContext(referencedMessage);

      // Send the reply to all other participants
      await Promise.all(
        otherParticipants.map((participant) =>
          this.sendReplyToParticipant(message, participant, replyContext),
        ),
      );

      // Store the message in the database (only if call exists in DB)
      try {
        await this.callDbService.addMessage(
          activeCall.id,
          message.author.id,
          message.author.username,
          message.content,
          message.attachments.first()?.url,
        );
      }
      catch (error) {
        // If the call doesn't exist in the database, log but don't fail the whole process
        Logger.warn(
          `Failed to store message in database for call ${activeCall.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }

      Logger.debug(`Processed reply message in call ${activeCall.id}`);
    }
    catch (error) {
      Logger.error('Failed to process call reply:', error);
    }
  }

  /**
   * Creates reply context information from the referenced message
   */
  private async createReplyContext(referencedMessage?: Message): Promise<{
    hasReply: boolean;
    replyAuthor?: string;
    replyAuthorAvatar?: string;
    replyContent?: string;
    replyTimestamp?: Date;
  }> {
    if (!referencedMessage) {
      return { hasReply: false };
    }

    // Truncate long reply content for better display
    const maxReplyLength = 100;
    let replyContent = referencedMessage.content;
    if (replyContent && replyContent.length > maxReplyLength) {
      replyContent = `${replyContent.substring(0, maxReplyLength)}...`;
    }

    return {
      hasReply: true,
      replyAuthor: referencedMessage.author.username,
      replyAuthorAvatar: referencedMessage.author.displayAvatarURL(),
      replyContent,
      replyTimestamp: referencedMessage.createdAt,
    };
  }

  /**
   * Sends a reply message to a participant using embeds for replies
   */
  private async sendReplyToParticipant(
    message: Message<true>,
    participant: CallParticipant,
    replyContext: {
      hasReply: boolean;
      replyAuthor?: string;
      replyAuthorAvatar?: string;
      replyContent?: string;
      replyTimestamp?: Date;
    },
  ): Promise<void> {
    try {
      // Include attachment URL in content if present
      const attachmentURL = message.attachments.first()?.url;
      const contentWithAttachment = attachmentURL
        ? `${message.content}\n${attachmentURL}`
        : message.content;

      if (replyContext.hasReply) {
        // Create embed for reply context
        const replyEmbed = {
          color: 0x5865f2, // Discord blurple color
          author: {
            name: `Replying to ${replyContext.replyAuthor}`,
            icon_url: replyContext.replyAuthorAvatar,
          },
          description: replyContext.replyContent ? `> ${replyContext.replyContent}` : undefined,
        };

        // Send message with reply embed
        await BroadcastService.sendMessage(participant.webhookUrl, {
          content: contentWithAttachment,
          embeds: [replyEmbed],
          username: message.author.username,
          avatarURL: message.author?.displayAvatarURL(),
          allowedMentions: { parse: [] },
        });
      }
      else {
        // Send regular message with just content
        await BroadcastService.sendMessage(participant.webhookUrl, {
          content: contentWithAttachment,
          username: message.author.username,
          avatarURL: message.author.displayAvatarURL(),
          allowedMentions: { parse: [] },
        });
      }
    }
    catch (error) {
      Logger.error(`Failed to send reply to participant ${participant.channelId}:`, error);
    }
  }
}
