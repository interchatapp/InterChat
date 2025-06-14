import { Message as MessageDB } from '#src/generated/prisma/client/index.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import Constants from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';
import { stripIndents } from 'common-tags';
import { Client, EmbedBuilder, codeBlock } from 'discord.js';

export const logMsgDelete = async (
  client: Client,
  originalMsg: MessageDB,
  logConfig: HubLogManager,
  opts: { hubName: string; modName: string },
) => {
  // Try to use the specific message moderation channel first, fallback to modLogs
  const messageModerationChannelId = logConfig.config.messageModerationChannelId;
  const channelId = messageModerationChannelId;
  if (!channelId) return;

  const { authorId, guildId, content } = originalMsg;
  const user = await client.users.fetch(authorId).catch(() => null);
  const server = await client.fetchGuild(guildId).catch(() => null);

  const embed = new EmbedBuilder()
    .setDescription(
      stripIndents`
      ### ${getEmoji('delete_icon', client)} Message Deleted
      **Message Content:**
      ${codeBlock(content.length > 0 ? content : 'No content provided.')}
    `,
    )
    .setColor(Constants.Colors.invisible)
    .setImage(originalMsg.imageUrl || null)
    .addFields([
      {
        name: `${getEmoji('person_icon', client)} User`,
        value: `${user?.username} (\`${authorId}\`)`,
      },
      {
        name: `${getEmoji('rules_icon', client)} Server`,
        value: `${server?.name} (\`${guildId}\`)`,
      },
      { name: `${getEmoji('globe_icon', client)} Hub`, value: opts.hubName },
    ])
    .setFooter({ text: `Deleted by: ${opts.modName}` });

  await sendLog(client.cluster, channelId, embed);
};

export const logMsgEdit = async (
  client: Client,
  originalMsg: MessageDB,
  newContent: string,
  logConfig: HubLogManager,
  opts: { hubName: string; modName: string },
) => {
  // Try to use the specific message moderation channel first, fallback to modLogs
  const messageModerationChannelId = logConfig.config.messageModerationChannelId;
  const channelId = messageModerationChannelId;
  if (!channelId) return;

  const { authorId, guildId, content } = originalMsg;
  const user = await client.users.fetch(authorId).catch(() => null);
  const server = await client.fetchGuild(guildId).catch(() => null);

  const embed = new EmbedBuilder()
    .setDescription(
      stripIndents`
      ### ${getEmoji('edit_icon', client)} Message Edited
      **Before:**
      ${codeBlock(content.length > 0 ? content : 'No content provided.')}
      **After:**
      ${codeBlock(newContent.length > 0 ? newContent : 'No content provided.')}
    `,
    )
    .setColor(Constants.Colors.invisible)
    .setImage(originalMsg.imageUrl || null)
    .addFields([
      {
        name: `${getEmoji('person_icon', client)} User`,
        value: `${user?.username} (\`${authorId}\`)`,
      },
      {
        name: `${getEmoji('rules_icon', client)} Server`,
        value: `${server?.name} (\`${guildId}\`)`,
      },
      { name: `${getEmoji('globe_icon', client)} Hub`, value: opts.hubName },
    ])
    .setFooter({ text: `Edited by: ${opts.modName}` });

  await sendLog(client.cluster, channelId, embed);
};
