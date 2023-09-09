import { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { getDb } from '../Utils/functions/utils';
import updateMessageReactions from '../Scripts/reactions/updateMessage';

export default {
  name: 'messageReactionAdd',
  async execute(reaction: MessageReaction| PartialMessageReaction, user: User | PartialUser) { // user: User | PartialUser
    const db = getDb();
    const messageInDb = await db.messageData.findFirst({
      where: { channelAndMessageIds: { some: { messageId: reaction.message.id } } },
    });

    if (!messageInDb) return;
    const connections = await db.connectedList.findMany({
      where: {
        channelId: { in: messageInDb?.channelAndMessageIds.map((c) => c.channelId) },
        connected: true,
      },
    });


    const reactedEmoji = reaction.emoji.toString();
    const reactions = messageInDb.reactions?.valueOf() as Record<string, string[]>; // eg. { '👍': 1, '👎': 2 }
    reactions[reactedEmoji] ? reactions[reactedEmoji].push(user.id) : reactions[reactedEmoji] = [user.id];

    await db.messageData.update({
      where: { id: messageInDb.id },
      data: { reactions: reactions },
    });

    updateMessageReactions(connections, messageInDb.channelAndMessageIds, reactions);
  },
};
