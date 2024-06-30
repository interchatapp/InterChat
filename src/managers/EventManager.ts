import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Guild,
  User,
  GuildChannel,
  GuildTextBasedChannel,
  HexColorString,
  Message,
  MessageReaction,
  PartialUser,
  Interaction,
  Client,
} from 'discord.js';
import {
  checkIfStaff,
  getAttachmentURL,
  getUserLocale,
  handleError,
  simpleEmbed,
  wait,
} from '../utils/Utils.js';
import db from '../utils/Db.js';
import Logger from '../utils/Logger.js';
import SuperClient from '../core/Client.js';
import GatewayEvent from '../decorators/GatewayEvent.js';
import sendBroadcast from '../scripts/network/sendBroadcast.js';
import storeMessageData from '../scripts/network/storeMessageData.js';
import getWelcomeTargets from '../scripts/guilds/getWelcomeTarget.js';
import { t } from '../utils/Locale.js';
import { check } from '../utils/Profanity.js';
import { runChecks } from '../scripts/network/runChecks.js';
import { stripIndents } from 'common-tags';
import { logGuildJoin, logGuildLeave } from '../scripts/guilds/goals.js';
import { channels, emojis, colors, LINKS } from '../utils/Constants.js';
import { getReferredMsgData, sendWelcomeMsg } from '../scripts/network/helpers.js';
import { HubSettingsBitField } from '../utils/BitFields.js';
import { addReaction, updateReactions } from '../scripts/reaction/actions.js';
import { checkBlacklists } from '../scripts/reaction/helpers.js';
import { CustomID } from '../utils/CustomID.js';
import { logGuildLeaveToHub } from '../utils/HubLogger/JoinLeave.js';
import { deleteConnections, modifyConnection } from '../utils/ConnectedList.js';

export default abstract class EventManager {
  @GatewayEvent('ready')
  static onReady(client: Client) {
    Logger.info(`Logged in as ${client.user?.tag}!`);
  }

  @GatewayEvent('shardReady')
  static onShardReady(s: number, u: Set<string>) {
    if (u) {
      Logger.warn(`Shard ${s} is ready but ${u.size} guilds are unavailable.`);
    }
    else {
      Logger.info(`Shard ${s} is ready!`);
    }
  }

  @GatewayEvent('messageReactionAdd')
  static async onReactionAdd(reaction: MessageReaction, user: User | PartialUser) {
    if (user.bot || !reaction.message.inGuild()) return;

    const cooldown = reaction.client.reactionCooldowns.get(user.id);
    if (cooldown && cooldown > Date.now()) return;

    // add user to cooldown list
    user.client.reactionCooldowns.set(user.id, Date.now() + 3000);

    const originalMsg = (
      await db.broadcastedMessages.findFirst({
        where: { messageId: reaction.message.id },
        include: { originalMsg: { include: { hub: true, broadcastMsgs: true } } },
      })
    )?.originalMsg;

    if (!originalMsg?.hub || !new HubSettingsBitField(originalMsg.hub.settings).has('Reactions')) {
      return;
    }

    Logger.info(
      `${reaction.emoji.name} reacted by ${user.tag} guild ${reaction.message.guild?.name} (${reaction.message.guildId}). Hub: ${originalMsg.hub.name}`,
    );

    const { userBlacklisted, serverBlacklisted } = await checkBlacklists(
      user.client,
      originalMsg.hub.id,
      reaction.message.guildId,
      user.id,
    );

    if (userBlacklisted || serverBlacklisted) return;

    const reactedEmoji = reaction.emoji.toString();
    const dbReactions = (originalMsg.reactions?.valueOf() ?? {}) as { [key: string]: string[] }; // eg. { '👍': 1, '👎': 2 }
    const emojiAlreadyReacted = dbReactions[reactedEmoji] ?? [user.id];

    // max 10 reactions
    if (Object.keys(dbReactions).length >= 10) return;

    // if there already are reactions by others
    // and the user hasn't reacted yet
    !emojiAlreadyReacted?.includes(user.id)
      ? // add user to the array
      addReaction(dbReactions, user.id, reactedEmoji)
      : // or update the data with a new arr containing userId
      (dbReactions[reactedEmoji] = emojiAlreadyReacted);

    await db.originalMessages.update({
      where: { messageId: originalMsg.messageId },
      data: { reactions: dbReactions },
    });

    reaction.users.remove(user.id).catch(() => null);
    await updateReactions(originalMsg.broadcastMsgs, dbReactions);
  }

  @GatewayEvent('webhooksUpdate')
  static async onWebhooksUpdate(channel: GuildChannel) {
    if (!channel.isTextBased()) return;

    try {
      const connection = channel.client.connectionCache.find(
        (c) => c.connected && (c.channelId === channel.id || c.parentId === channel.id),
      );

      if (!connection) return;

      Logger.info(`Webhook for ${channel.id} was updated`);

      const webhooks = await channel.fetchWebhooks();
      const webhook = webhooks.find((w) => w.url === connection.webhookURL);

      // only continue if webhook was deleted
      if (!webhook) {
        // disconnect the channel
        await modifyConnection({ id: connection.id }, { connected: false });

        const client = SuperClient.instance;

        // send an alert to the channel
        const networkChannel = channel.isTextBased()
          ? channel
          : ((await client.channels.fetch(connection.channelId)) as GuildTextBasedChannel);

        await networkChannel.send(
          t({ phrase: 'misc.webhookNoLongerExists', locale: 'en' }, { emoji: emojis.info }),
        );
      }
    }
    catch (error) {
      Logger.error('WebhooksUpdateError:', error);
    }
  }

  @GatewayEvent('guildCreate')
  static async onGuildCreate(guild: Guild) {
    Logger.info(`Joined ${guild.name} (${guild.id})`);

    // log that bot joined a guild to goal channel in support server
    await logGuildJoin(guild, channels.goal);

    const { guildOwner, guildChannel } = await getWelcomeTargets(guild);

    // notify the person who added the bot
    const embed = new EmbedBuilder()
      .setTitle('👋 Thanks for adding me to your server!')
      .setDescription(
        stripIndents`              
            Take your first step into the world of cross-server chatting with InterChat! 🚀 Explore public hubs, connect with multiple servers, and add a splash of excitement to your server experience. ${emojis.clipart}
            ### Getting Started
            - Simply run </help:924659340898619398> to see an easy to follow setup guide.
            - Or visit our in-depth [web guide](${LINKS.DOCS}/setup) for more information.

            If you need help, join our [support server](${LINKS.SUPPORT_INVITE}) and we'll be happy to help you out!
        `,
      )
      .setColor(colors.interchatBlue)
      .setFooter({ text: `Sent for: ${guild.name}`, iconURL: guild.iconURL() ?? undefined });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Docs')
        .setURL(`${LINKS.DOCS}/setup`)
        .setEmoji(emojis.guide_icon)
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Terms')
        .setURL(`${LINKS.DOCS}/legal/terms`)
        .setEmoji(emojis.docs_icon)
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Privacy')
        .setURL(`${LINKS.DOCS}/legal/privacy`)
        .setEmoji(emojis.lock_icon)
        .setStyle(ButtonStyle.Link),
    );

    const channelToSend = guildOwner ?? guildChannel;
    const message = { embeds: [embed], components: [buttons] };

    channelToSend?.send(message).catch(() => guildChannel?.send(message).catch(() => null));

    const { hasProfanity, hasSlurs } = check(guild.name);
    if (!hasProfanity && !hasSlurs) return;

    const profaneErrorEmbed = new EmbedBuilder()
      .setTitle('Leave Notice 👋')
      .setDescription(
        `${emojis.no} Your server name contains profanity or sensitive content. Please change it before using InterChat.`,
      )
      .setColor(colors.invisible)
      .setFooter({ text: `Sent for: ${guild.name}`, iconURL: guild.iconURL() ?? undefined });

    const leaveMsg = { embeds: [profaneErrorEmbed] };

    channelToSend?.send(leaveMsg).catch(() => guildChannel?.send(leaveMsg).catch(() => null));
    await guild.leave();
  }

  @GatewayEvent('guildDelete')
  static async onGuildDelete(guild: Guild) {
    if (!guild.available) return;

    Logger.info(`Left ${guild.name} (${guild.id})`);

    const connections = await db.connectedList.findMany({ where: { serverId: guild.id } });
    await deleteConnections({ serverId: guild.id });

    connections.forEach(async (connection) => await logGuildLeaveToHub(connection.hubId, guild));

    await logGuildLeave(guild, channels.goal);
  }

  @GatewayEvent('messageCreate')
  static async onMessageCreate(message: Message): Promise<void> {
    if (message.author.bot || message.system || message.webhookId || !message.inGuild()) return;

    const { connectionCache, cachePopulated } = message.client;

    if (!cachePopulated) {
      Logger.debug('[InterChat]: Connection cache not populated, 5 secs until retry...');
      await wait(5000);

      EventManager.onMessageCreate(message);
      return;
    }

    // check if the message was sent in a network channel
    const connection = connectionCache.get(message.channel.id);
    if (!connection?.connected) return;

    const hub = await db.hubs.findFirst({ where: { id: connection.hubId } });
    if (!hub) return;

    const settings = new HubSettingsBitField(hub.settings);
    const hubConnections = connectionCache.filter(
      (con) =>
        con.hubId === connection.hubId && con.connected && con.channelId !== message.channel.id,
    );

    let userData = await db.userData.findFirst({ where: { userId: message.author.id } });
    if (!userData?.viewedNetworkWelcome) {
      userData = await db.userData.upsert({
        where: { userId: message.author.id },
        create: {
          userId: message.author.id,
          username: message.author.username,
          viewedNetworkWelcome: true,
        },
        update: { viewedNetworkWelcome: true },
      });

      await sendWelcomeMsg(message, hubConnections.size.toString(), hub.name);
    }

    // set locale for the user
    message.author.locale = getUserLocale(userData);

    const attachmentURL =
      message.attachments.first()?.url ?? (await getAttachmentURL(message.content));

    // run checks on the message to determine if it can be sent in the network
    const passingChecks = await runChecks(message, connection.hubId, {
      settings,
      userData,
      attachmentURL,
    });

    if (passingChecks === false) return;

    message.channel.sendTyping().catch(() => null);

    // fetch the referred message  (message being replied to) from discord
    const referredMessage = message.reference
      ? await message.fetchReference().catch(() => null)
      : null;

    const { dbReferrence, referredAuthor } = await getReferredMsgData(referredMessage);
    const sendResult = sendBroadcast(message, hub, hubConnections, settings, {
      attachmentURL,
      dbReferrence,
      referredAuthor,
      referredMessage,
      embedColor: connection.embedColor as HexColorString,
    });

    // only delete the message if there is no attachment or if the user has already viewed the welcome message
    // deleting attachments will make the image not show up in the embed (discord removes it from its cdn)
    // if (!attachment) message.delete().catch(() => null);

    // store the message in the db
    await storeMessageData(message, await Promise.all(sendResult), connection.hubId, dbReferrence);
  }

  @GatewayEvent('interactionCreate')
  static async onInteractionCreate(interaction: Interaction): Promise<void> {
    try {
      const { commands, interactions } = interaction.client;
      const userData = await db.userData.findFirst({ where: { userId: interaction.user.id } });
      interaction.user.locale = getUserLocale(userData);

      if (userData?.banMeta?.reason) {
        if (interaction.isRepliable()) {
          await interaction.reply({
            content: t(
              { phrase: 'errors.banned', locale: interaction.user.locale },
              {
                emoji: emojis.no,
                reason: userData.banMeta.reason,
                support_invite: LINKS.SUPPORT_INVITE,
              },
            ),
            ephemeral: true,
          });
        }
        return;
      }

      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const ignoreList = ['page_', 'onboarding_'];
        const customId = CustomID.parseCustomId(interaction.customId);
        if (ignoreList.includes(customId.prefix)) return; // for components have own component collector

        // component decorator stuff
        const customIdSuffix = customId.suffix ? `:${customId.suffix}` : '';
        const interactionHandler =
          interactions.get(`${customId.prefix}${customIdSuffix}`) ??
          interactions.get(customId.prefix);
        const isExpiredInteraction = customId.expiry && customId.expiry < Date.now();

        if (!interactionHandler || isExpiredInteraction) {
          await interaction.reply({
            embeds: [
              simpleEmbed(
                t(
                  { phrase: 'errors.notUsable', locale: interaction.user.locale },
                  { emoji: emojis.no },
                ),
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        await interactionHandler(interaction);
        return;
      }

      const command = commands.get(interaction.commandName);

      if (command?.staffOnly && !checkIfStaff(interaction.user.id)) return;

      // slash commands
      if (!interaction.isAutocomplete()) await command?.execute(interaction);
      // autocompletes
      else if (command?.autocomplete) await command.autocomplete(interaction);
    }
    catch (e) {
      handleError(e, interaction);
    }
  }
}
