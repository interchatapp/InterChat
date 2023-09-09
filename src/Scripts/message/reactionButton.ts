import { ButtonInteraction } from 'discord.js';
import { getDb } from '../../Utils/functions/utils';
import updateMessageReactions from '../reactions/updateMessage';

export default {
  async execute(interaction: ButtonInteraction) {
    interaction.deferUpdate();

    const db = getDb();
    const messageInDb = await db.messageData.findFirst({
      where: { channelAndMessageIds: { some: { messageId: interaction.message.id } } },
      include: { hub: { select: { connections: { where: { connected: true } } } } },
    });

    if (!messageInDb || !messageInDb.hub) return;

    const connections = await db.connectedList.findMany({
      where: {
        channelId: { in: messageInDb?.channelAndMessageIds.map((c) => c.channelId) },
        connected: true,
      },
    });

    const reactedEmoji = interaction.customId.split('reaction_')[1];
    const dbReactions = messageInDb.reactions?.valueOf() as Record<string, string[]>;

    if (dbReactions[reactedEmoji]) {
      // If the user already reacted, remove the reaction
      if (dbReactions[reactedEmoji].includes(interaction.user.id)) {
        const userIndex = dbReactions[reactedEmoji].indexOf(interaction.user.id);
        dbReactions[reactedEmoji].splice(userIndex, 1);
      }
      // Add the user to the array
      else {
        dbReactions[reactedEmoji].push(interaction.user.id);
      }
    }

    await db.messageData.update({
      where: { id: messageInDb.id },
      data: { reactions: dbReactions },
    });

    // Update the message
    updateMessageReactions(connections, messageInDb.channelAndMessageIds, dbReactions);
  },
};