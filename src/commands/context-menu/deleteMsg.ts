import {
  ApplicationCommandType,
  CacheType,
  ContextMenuCommandInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import BaseCommand from '../BaseCommand.js';
import { checkIfStaff } from '../../utils/Utils.js';
import { emojis } from '../../utils/Constants.js';
import db from '../../utils/Db.js';

export default class DeleteMessage extends BaseCommand {
  readonly data: RESTPostAPIApplicationCommandsJSONBody = {
    type: ApplicationCommandType.Message,
    name: 'Delete Message',
    dm_permission: false,
  };

  async execute(interaction: ContextMenuCommandInteraction<CacheType>) {
    await interaction.deferReply({ ephemeral: true });

    const messageInDb = await db?.messageData.findFirst({
      where: { channelAndMessageIds: { some: { messageId: { equals: interaction.targetId } } } },
      include: { hub: true },
    });

    if (!messageInDb) {
      return await interaction.editReply(
        'Unknown Message. If it has been sent in the past minute, please wait few more seconds and try again.',
      );
    }

    const interchatStaff = checkIfStaff(interaction.user.id);
    if (
      !interchatStaff &&
      !messageInDb.hub?.moderators.find((m) => m.userId === interaction.user.id) &&
      messageInDb.hub?.ownerId !== interaction.user.id &&
      interaction.user.id !== messageInDb.authorId
    ) {
      return await interaction.editReply(`${emojis.no} You are not the author of this message.`);
    }

    // find all the messages through the network
    const channelSettingsArr = await db.connectedList.findMany({
      where: { channelId: { in: messageInDb.channelAndMessageIds.map((c) => c.channelId) } },
    });
    const results = messageInDb.channelAndMessageIds.map(async (element) => {
      const connection = channelSettingsArr.find((c) => c.channelId === element.channelId);
      if (!connection) return false;

      const webhookURL = connection.webhookURL.split('/');
      const webhook = await interaction.client
        .fetchWebhook(webhookURL[webhookURL.length - 2])
        ?.catch(() => null);

      if (webhook?.owner?.id !== interaction.client.user?.id) return false;

      // finally, delete the message
      return await webhook
        ?.deleteMessage(element.messageId, connection.parentId ? connection.channelId : undefined)
        .then(() => true)
        .catch(() => false);
    });

    const resultsArray = await Promise.all(results);
    const deleted = resultsArray.reduce((acc, cur) => acc + (cur ? 1 : 0), 0);
    await interaction
      .editReply(
        `${emojis.yes} Message by **<@${messageInDb.authorId}> (${messageInDb.authorId})** has been deleted from __**${deleted}/${resultsArray.length}**__ servers.`,
      )
      .catch(() => null);

    // log the deleted message for moderation purposes TODO
    // if (interaction.inCachedGuild()) networkMessageDelete(interaction.member, interaction.targetMessage);
  }
}
