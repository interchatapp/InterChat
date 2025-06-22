import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from 'discord.js';

import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import {
  ActiveCall,
  CallMessage,
  CallParticipant,
} from '#src/types/CallTypes.js';
import { DistributedCallingLibrary } from '#src/lib/userphone/DistributedCallingLibrary.js';
import { CustomID } from '#src/utils/CustomID.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { checkIfStaff } from '#src/utils/Utils.js';
import { RedisKeys } from '#utils/Constants.js';
import Logger from '#utils/Logger.js';
import { getRedis } from '#utils/Redis.js';
import BanManager from '#src/managers/UserBanManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';

export interface CallReportData {
  callId: string;
  reporterId: string;
  reporterTag: string;
  reporterChannelId: string;
  reporterGuildId: string;
  serverId: string;
  reason: string;
  reportedUsers: string[];
  timestamp: number;
  status: string;
  resolvedBy?: string;
  resolvedAt?: number;
  warnedUsers?: string[];
  bannedUsers?: string[];
  callDuration?: number;
}

/**
 * Command for staff members to view reported calls and take action
 */
export default class ViewReportedCallCommand extends BaseCommand {
  constructor() {
    super({
      name: 'view_reported_call',
      description: '🚩 View a reported call and take action (Staff Only)',
      // staffOnly: true,
      types: { slash: true, prefix: true },
      aliases: ['vrc'],
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'call_id',
          description: 'The ID of the reported call to view',
          required: true,
        },
      ],
    });
  }

  /**
   * Helper method to get the distributed calling library
   */
  private getDistributedCallingLibrary(client: Client): DistributedCallingLibrary | null {
    return client.getDistributedCallingLibrary();
  }

  async execute(ctx: Context) {
    // Verify the user is a staff member
    if (!checkIfStaff(ctx.user.id)) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} You don't have permission to use this command.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the call ID from options
    const callId = ctx.options.getString('call_id', true);

    // Defer the reply while we fetch data
    await ctx.deferReply();

    // Get call data
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data for ID: \`${callId}\`. The call might have ended too long ago.`,
      });
      return;
    }

    // Get report data
    const reportData = await this.getReportData(callId);

    if (!reportData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('info_icon')} Found call data, but no report was filed for this call.`,
      });
      return;
    }

    // Get messages for this call
    const messages = await this.getCallMessages(callId);

    // Create the UI with pagination
    await this.displayCallReportWithPagination(ctx, callData, reportData, messages);
  }

  /**
   * Get report data for a call
   */
  private async getReportData(callId: string) {
    const redis = getRedis();
    const reportKey = `${RedisKeys.Call}:report:${callId}`;
    const reportData = await redis.get(reportKey);

    if (!reportData) return null;

    return JSON.parse(reportData) as CallReportData;
  }

  /**
   * Get messages exchanged during a call
   */
  private async getCallMessages(callId: string) {
    const redis = getRedis();
    const messagesKey = `${RedisKeys.Call}:messages:${callId}`;
    const messages = await redis.lrange(messagesKey, 0, -1);

    return messages.map((msg) => JSON.parse(msg)).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Display the call report with messages and action buttons
   */
  public async displayCallReport(
    ctx: Context | ComponentContext,
    callData: ActiveCall,
    reportData: CallReportData,
    messages: CallMessage[],
    page: number = 0,
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header with call information
    container.addTextDisplayComponents(
      ui.createHeader(
        'Call Report Review',
        `Reported ${time(new Date(reportData.timestamp), TimestampStyles.RelativeTime)}`,
        'alert_icon',
      ),
    );

    // Add call metadata section with enhanced server information
    const enhancedParticipants = await this.formatParticipantsWithNames(
      callData.participants,
      ctx.client,
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        **Report Reason:** ${reportData.reason}
        **Reporter:** @${reportData.reporterTag} (${reportData.reporterId})
        **Call ID:** \`${callData.id}\`
        **Call Duration:** ${this.formatDuration(reportData.callDuration || 0)}
        **Participants:** ${enhancedParticipants}
        `,
      ),
    );
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Small),
    );

    // Add message display
    const messagesPerPage = 5;
    const totalPages = Math.ceil(messages.length / messagesPerPage);
    const startIdx = page * messagesPerPage;
    const endIdx = Math.min(startIdx + messagesPerPage, messages.length);
    const pageMessages = messages.slice(startIdx, endIdx);

    // Add messages section with enhanced server information
    if (messages.length > 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## Message History (${startIdx + 1}-${endIdx} of ${messages.length})`,
        ),
      );

      // Create user-to-server mapping for efficient lookups
      const userServerMap = await this.createUserServerMap(callData.participants, ctx.client);

      for (const msg of pageMessages) {
        const serverInfo = userServerMap.get(msg.authorId);
        const serverName = serverInfo ? serverInfo.name : 'Unknown Server';

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            stripIndents`
            **${msg.authorUsername}** (${serverName}) - ${msg.authorId} - ${time(new Date(msg.timestamp), TimestampStyles.RelativeTime)}
            \`\`\`${msg.content || '*[No text content]*'}\`\`\`
            ${msg.attachmentUrl ? `[Attachment](${msg.attachmentUrl})` : ''}
            `,
          ),
        );
      }
    }
    else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('*No messages were recorded for this call.*'),
      );
    }

    // Add pagination buttons if needed
    if (totalPages > 1) {
      container.addActionRowComponents((row) => {
        // Previous page button
        if (page > 0) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(
                new CustomID('view_call:prev', [callData.id, page.toString()]).toString(),
              )
              .setEmoji(getEmoji('arrow_left', ctx.client))
              .setStyle(ButtonStyle.Secondary),
          );
        }

        // Page indicator
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('page_indicator')
            .setLabel(`Page ${page + 1}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );

        // Next page button
        if (page < totalPages - 1) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(
                new CustomID('view_call:next', [callData.id, page.toString()]).toString(),
              )
              .setEmoji(getEmoji('arrow_right', ctx.client))
              .setStyle(ButtonStyle.Secondary),
          );
        }

        return row;
      });
    }

    // Add action buttons
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('view_call:dismiss', [callData.id]).toString())
        .setLabel('Dismiss Report')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(new CustomID('view_call:ban_users', [callData.id]).toString())
        .setLabel('Ban Users')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(new CustomID('view_call:ban_servers', [callData.id]).toString())
        .setLabel('Ban Servers')
        .setStyle(ButtonStyle.Primary),
    );

    // Send or update the message
    try {
      const components = [container, actionRow];
      await ctx.editOrReply({ components }, ['IsComponentsV2']);
    }
    catch (error) {
      Logger.error('Error displaying call report:', error);
    }
  }

  /**
   * Display the call report with messages and action buttons using PaginationManager
   */
  private async displayCallReportWithPagination(
    ctx: Context | ComponentContext,
    callData: ActiveCall,
    reportData: CallReportData,
    messages: CallMessage[],
  ): Promise<void> {
    try {
      // Use the simpler displayCallReport method which includes action buttons
      await this.displayCallReport(ctx, callData, reportData, messages);
    }
    catch (error) {
      Logger.error('Error displaying call report with pagination:', error);

      // Fall back to a basic error message
      await ctx.editOrReply({
        content: `${ctx.getEmoji('x_icon')} Failed to display call report. Please try again.`,
        components: [],
      });
    }
  }


  /**
   * Format call duration in a human-readable format
   */
  private formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) {
      return `${seconds} seconds`;
    }

    return `${minutes} min ${remainingSeconds} sec`;
  }


  /**
   * Format participants information with server names
   */
  private async formatParticipantsWithNames(
    participants: CallParticipant[],
    client: Client,
  ): Promise<string> {
    const formattedParticipants = await Promise.all(
      participants.map(async (p) => {
        const guild = await client.guilds.fetch(p.guildId).catch(() => null);
        const guildName = guild?.name || 'Unknown Server';
        return `**${guildName}**: ${p.users.size} users from <#${p.channelId}> (${p.guildId})`;
      }),
    );
    return formattedParticipants.join('\n');
  }

  /**
   * Create a mapping of user IDs to their server information for efficient lookups
   */
  private async createUserServerMap(
    participants: CallParticipant[],
    client: Client,
  ): Promise<Map<string, { name: string; id: string }>> {
    const userServerMap = new Map<string, { name: string; id: string }>();

    for (const participant of participants) {
      const guild = await client.guilds.fetch(participant.guildId).catch(() => null);
      const guildName = guild?.name || 'Unknown Server';

      const users = participant.users instanceof Set
        ? Array.from(participant.users)
        : participant.users as string[];

      for (const userId of users) {
        userServerMap.set(userId, {
          name: guildName,
          id: participant.guildId,
        });
      }
    }

    return userServerMap;
  }

  @RegisterInteractionHandler('view_call', 'next')
  async handleNextPage(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, currentPageStr] = ctx.customId.args;
    const currentPage = parseInt(currentPageStr, 10);
    const nextPage = currentPage + 1;

    // Get call data
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data. The call might have ended too long ago.`,
        components: [],
      });
      return;
    }

    // Get report data
    const reportData = await this.getReportData(callId);

    if (!reportData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('info_icon')} Found call data, but no report was filed for this call.`,
        components: [],
      });
      return;
    }

    // Get messages for this call
    const messages = await this.getCallMessages(callId);

    // Display the next page
    await this.displayCallReport(ctx, callData, reportData, messages, nextPage);
  }

  @RegisterInteractionHandler('view_call', 'prev')
  async handlePrevPage(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, currentPageStr] = ctx.customId.args;
    const currentPage = parseInt(currentPageStr, 10);
    const prevPage = Math.max(0, currentPage - 1);

    // Get call data
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data. The call might have ended too long ago.`,
        components: [],
      });
      return;
    }

    // Get report data
    const reportData = await this.getReportData(callId);

    if (!reportData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('info_icon')} Found call data, but no report was filed for this call.`,
        components: [],
      });
      return;
    }

    // Get messages for this call
    const messages = await this.getCallMessages(callId);

    // Display the previous page
    await this.displayCallReport(ctx, callData, reportData, messages, prevPage);
  }

  @RegisterInteractionHandler('view_call', 'dismiss')
  async handleDismissReport(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Mark the report as dismissed
    const redis = getRedis();
    const reportKey = `${RedisKeys.Call}:report:${callId}`;
    const reportData = await redis.get(reportKey);

    if (!reportData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find report data.`,
        components: [],
      });
      return;
    }

    const parsedReport = JSON.parse(reportData);
    parsedReport.status = 'dismissed';
    parsedReport.resolvedBy = ctx.user.id;
    parsedReport.resolvedAt = Date.now();

    await redis.set(reportKey, JSON.stringify(parsedReport));

    // Notify the user
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Report Dismissed',
      `The report for call ${callId} has been dismissed. No further action will be taken.`,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Log the action
    Logger.info(
      `Staff member ${ctx.user.tag} (${ctx.user.id}) dismissed report for call ${callId}`,
    );
  }

  // Warning system removed - only ban system is used for call moderation

  @RegisterInteractionHandler('view_call', 'ban_users')
  async handleBanUsers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find users
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data.`,
        components: [],
      });
      return;
    }

    // Show user selection interface
    await this.showUserSelectionInterface(ctx, callData);
  }

  @RegisterInteractionHandler('view_call', 'ban_servers')
  async handleBanServers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find servers
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data.`,
        components: [],
      });
      return;
    }

    // Show server selection interface
    await this.showServerSelectionInterface(ctx, callData);
  }

  /**
   * Show user selection interface for banning
   */
  private async showUserSelectionInterface(
    ctx: ComponentContext,
    callData: ActiveCall,
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Get all users from the call with their server information
    const userOptions: Array<{ userId: string; guildId: string; guildName: string }> = [];

    for (const participant of callData.participants) {
      const guild = await ctx.client.guilds.fetch(participant.guildId).catch(() => null);
      const guildName = guild?.name || `Unknown Server (${participant.guildId})`;

      const users = participant.users instanceof Set
        ? Array.from(participant.users)
        : participant.users as string[];
      for (const userId of users) {
        userOptions.push({
          userId,
          guildId: participant.guildId,
          guildName,
        });
      }
    }

    if (userOptions.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No users found in this call.`,
        components: [],
      });
      return;
    }

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Select Users to Ban',
        `Choose which users to ban from the ${userOptions.length} participants`,
        'alert_icon',
      ),
    );

    // Add user selection menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(new CustomID('view_call:user_selected', [callData.id]).toString())
      .setPlaceholder('Select users to ban...')
      .setMinValues(1)
      .setMaxValues(Math.min(userOptions.length, 25)); // Discord limit

    for (const { userId, guildName } of userOptions.slice(0, 25)) { // Discord limit
      const user = await ctx.client.users.fetch(userId).catch(() => null);
      const username = user?.username || `Unknown User (${userId})`;

      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${username} from ${guildName}`)
          .setValue(userId)
          .setDescription(`User ID: ${userId}`),
      );
    }

    container.addActionRowComponents((row) => {
      row.addComponents(selectMenu);
      return row;
    });

    // Add action buttons
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:ban_all_users', [callData.id]).toString())
          .setLabel('Ban All Users')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:back', [callData.id]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Show server selection interface for banning
   */
  private async showServerSelectionInterface(
    ctx: ComponentContext,
    callData: ActiveCall,
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Get all servers from the call
    const serverOptions: Array<{ guildId: string; guildName: string; userCount: number }> = [];

    for (const participant of callData.participants) {
      const guild = await ctx.client.guilds.fetch(participant.guildId).catch(() => null);
      const guildName = guild?.name || `Unknown Server (${participant.guildId})`;
      const userCount = participant.users instanceof Set
        ? participant.users.size
        : (participant.users as string[]).length;

      serverOptions.push({
        guildId: participant.guildId,
        guildName,
        userCount,
      });
    }

    if (serverOptions.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No servers found in this call.`,
        components: [],
      });
      return;
    }

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Select Servers to Ban',
        `Choose which servers to ban from the ${serverOptions.length} participating servers`,
        'alert_icon',
      ),
    );

    // Add server selection menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(new CustomID('view_call:server_selected', [callData.id]).toString())
      .setPlaceholder('Select servers to ban...')
      .setMinValues(1)
      .setMaxValues(Math.min(serverOptions.length, 25)); // Discord limit

    for (const { guildId, guildName, userCount } of serverOptions.slice(0, 25)) { // Discord limit
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(guildName)
          .setValue(guildId)
          .setDescription(`${userCount} users • Server ID: ${guildId}`),
      );
    }

    container.addActionRowComponents((row) => {
      row.addComponents(selectMenu);
      return row;
    });

    // Add action buttons
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:ban_all_servers', [callData.id]).toString())
          .setLabel('Ban All Servers')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:back', [callData.id]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  // Handlers for user and server selection

  @RegisterInteractionHandler('view_call', 'user_selected')
  async handleUserSelected(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Type guard to ensure this is a string select menu interaction
    if (!ctx.interaction.isStringSelectMenu()) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Invalid interaction type.`,
        components: [],
      });
      return;
    }

    const selectedUsers = ctx.interaction.values;

    if (!selectedUsers || selectedUsers.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No users selected.`,
        components: [],
      });
      return;
    }

    // Show ban type selection for selected users
    await this.showBanTypeSelection(ctx, callId, selectedUsers, 'user');
  }

  @RegisterInteractionHandler('view_call', 'server_selected')
  async handleServerSelected(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Type guard to ensure this is a string select menu interaction
    if (!ctx.interaction.isStringSelectMenu()) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Invalid interaction type.`,
        components: [],
      });
      return;
    }

    const selectedServers = ctx.interaction.values;

    if (!selectedServers || selectedServers.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No servers selected.`,
        components: [],
      });
      return;
    }

    // Show ban type selection for selected servers
    await this.showBanTypeSelection(ctx, callId, selectedServers, 'server');
  }

  @RegisterInteractionHandler('view_call', 'ban_all_users')
  async handleBanAllUsers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find all users
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data.`,
        components: [],
      });
      return;
    }

    // Get all users from the call
    const allUsers: string[] = [];
    callData.participants.forEach((p) => {
      const users = p.users instanceof Set
        ? Array.from(p.users)
        : p.users as string[];
      allUsers.push(...users);
    });

    if (allUsers.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No users found in this call.`,
        components: [],
      });
      return;
    }

    // Show ban type selection for all users
    await this.showBanTypeSelection(ctx, callId, allUsers, 'user');
  }

  @RegisterInteractionHandler('view_call', 'ban_all_servers')
  async handleBanAllServers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find all servers
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);

    if (!callData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call data.`,
        components: [],
      });
      return;
    }

    // Get all servers from the call
    const allServers = callData.participants.map((p) => p.guildId);

    if (allServers.length === 0) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} No servers found in this call.`,
        components: [],
      });
      return;
    }

    // Show ban type selection for all servers
    await this.showBanTypeSelection(ctx, callId, allServers, 'server');
  }

  /**
   * Show ban type selection (permanent/temporary) for users or servers
   */
  private async showBanTypeSelection(
    ctx: ComponentContext,
    callId: string,
    targets: string[],
    type: 'user' | 'server',
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    const targetType = type === 'user' ? 'users' : 'servers';
    const targetCount = targets.length;

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Select Ban Type',
        `Choose ban type for ${targetCount} ${targetType}`,
        'alert_icon',
      ),
    );

    // Add ban type selection buttons
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:execute_permanent_ban', [callId, type, ...targets]).toString())
          .setLabel('Permanent Ban')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:show_temp_duration', [callId, type, ...targets]).toString())
          .setLabel('Temporary Ban')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:back', [callId]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('view_call', 'execute_permanent_ban')
  async handleExecutePermanentBan(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, type, ...targets] = ctx.customId.args;

    if (type === 'user') {
      await this.executeBans(ctx, callId, targets, 'PERMANENT');
    }
    else if (type === 'server') {
      await this.executeServerBans(ctx, callId, targets, 'PERMANENT');
    }
  }

  @RegisterInteractionHandler('view_call', 'show_temp_duration')
  async handleShowTempDuration(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, type, ...targets] = ctx.customId.args;
    await this.showTemporaryBanDurationSelection(ctx, callId, targets, type as 'user' | 'server');
  }

  /**
   * Show duration selection UI for temporary bans
   */
  private async showTemporaryBanDurationSelection(
    ctx: ComponentContext,
    callId: string,
    targets: string[],
    type: 'user' | 'server',
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    const targetType = type === 'user' ? 'users' : 'servers';
    const targetCount = targets.length;

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Select Ban Duration',
        `Choose how long to ban ${targetCount} ${targetType}`,
        'clock_icon',
      ),
    );

    // Add duration selection buttons
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:execute_temp_ban', [callId, type, '3600000', ...targets]).toString()) // 1 hour
          .setLabel('1 Hour')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:execute_temp_ban', [callId, type, '86400000', ...targets]).toString()) // 1 day
          .setLabel('1 Day')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:execute_temp_ban', [callId, type, '604800000', ...targets]).toString()) // 1 week
          .setLabel('1 Week')
          .setStyle(ButtonStyle.Primary),
      );
      return row;
    });

    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:execute_temp_ban', [callId, type, '2592000000', ...targets]).toString()) // 30 days
          .setLabel('30 Days')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(new CustomID('view_call:back', [callId]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('view_call', 'execute_temp_ban')
  async handleExecuteTempBan(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, type, durationStr, ...targets] = ctx.customId.args;
    const duration = parseInt(durationStr, 10);

    if (type === 'user') {
      await this.executeBans(ctx, callId, targets, 'TEMPORARY', duration);
    }
    else if (type === 'server') {
      await this.executeServerBans(ctx, callId, targets, 'TEMPORARY', duration);
    }
  }


  @RegisterInteractionHandler('view_call', 'back')
  async handleBackToReport(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data and report data to redisplay the original report
    const distributedCallingLibrary = this.getDistributedCallingLibrary(ctx.client);
    if (!distributedCallingLibrary) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
        components: [],
      });
      return;
    }
    const callData = await distributedCallingLibrary.getEndedCallData(callId);
    const reportData = await this.getReportData(callId);
    const messages = await this.getCallMessages(callId);

    if (!callData || !reportData) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Unable to find call or report data.`,
        components: [],
      });
      return;
    }

    await this.displayCallReport(ctx, callData, reportData, messages);
  }

  /**
   * Execute server bans for servers from a call
   */
  private async executeServerBans(
    ctx: ComponentContext,
    callId: string,
    serverIds: string[],
    banType: 'PERMANENT' | 'TEMPORARY',
    duration?: number,
  ): Promise<void> {
    const serverBanManager = new ServerBanManager();

    const reason = `Server banned from call ${callId} for violating InterChat rules`;
    const successfulBans: string[] = [];
    const failedBans: { serverId: string; error: string }[] = [];

    // Process each server
    for (const serverId of serverIds) {
      try {
        await serverBanManager.createServerBan({
          serverId,
          moderatorId: ctx.user.id,
          reason,
          type: banType,
          duration,
        });
        successfulBans.push(serverId);
      }
      catch (error) {
        failedBans.push({
          serverId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        Logger.error(`Failed to ban server ${serverId}:`, error);
      }
    }

    // Mark the report as resolved with server bans
    const redis = getRedis();
    const reportKey = `${RedisKeys.Call}:report:${callId}`;
    const reportData = await redis.get(reportKey);

    if (reportData) {
      const parsedReport = JSON.parse(reportData);
      parsedReport.status = 'server_banned';
      parsedReport.resolvedBy = ctx.user.id;
      parsedReport.resolvedAt = Date.now();
      parsedReport.bannedServers = successfulBans;
      await redis.set(reportKey, JSON.stringify(parsedReport));
    }

    // Create result message
    const ui = new UIComponents(ctx.client);
    const durationText = banType === 'TEMPORARY' && duration
      ? ` for ${this.formatDuration(duration)}`
      : ' permanently';

    let resultMessage = `${successfulBans.length} servers from call ${callId} have been banned${durationText}.`;

    if (failedBans.length > 0) {
      resultMessage += `\n\n⚠️ ${failedBans.length} server bans failed:`;
      failedBans.forEach(({ serverId, error }) => {
        resultMessage += `\n• Server ${serverId}: ${error}`;
      });
    }

    const container = successfulBans.length > 0
      ? ui.createSuccessMessage('Servers Banned', resultMessage)
      : ui.createErrorMessage('Server Ban Failed', resultMessage);

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Log the action
    Logger.info(
      `Staff member ${ctx.user.tag} (${ctx.user.id}) banned ${successfulBans.length}/${serverIds.length} servers from call ${callId}${durationText}`,
    );
  }

  /**
   * Execute bans for users from a call
   */
  private async executeBans(
    ctx: ComponentContext,
    callId: string,
    allUsers: string[],
    banType: 'PERMANENT' | 'TEMPORARY',
    duration?: number,
  ): Promise<void> {
    const banManager = new BanManager();

    const reason = `Banned from call ${callId} for violating InterChat rules`;
    const successfulBans: string[] = [];
    const failedBans: { userId: string; error: string }[] = [];

    // Process each user
    for (const userId of allUsers) {
      try {
        await banManager.createBan({
          userId,
          moderatorId: ctx.user.id,
          reason,
          type: banType,
          duration,
        });
        successfulBans.push(userId);
      }
      catch (error) {
        failedBans.push({
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        Logger.error(`Failed to ban user ${userId}:`, error);
      }
    }

    // Mark the report as resolved with bans
    const redis = getRedis();
    const reportKey = `${RedisKeys.Call}:report:${callId}`;
    const reportData = await redis.get(reportKey);

    if (reportData) {
      const parsedReport = JSON.parse(reportData);
      parsedReport.status = 'banned';
      parsedReport.resolvedBy = ctx.user.id;
      parsedReport.resolvedAt = Date.now();
      parsedReport.bannedUsers = successfulBans;
      await redis.set(reportKey, JSON.stringify(parsedReport));
    }

    // Create result message
    const ui = new UIComponents(ctx.client);
    const durationText = banType === 'TEMPORARY' && duration
      ? ` for ${this.formatDuration(duration)}`
      : ' permanently';

    let resultMessage = `${successfulBans.length} users from call ${callId} have been banned${durationText}.`;

    if (failedBans.length > 0) {
      resultMessage += `\n\n⚠️ ${failedBans.length} bans failed:`;
      failedBans.forEach(({ userId, error }) => {
        resultMessage += `\n• <@${userId}>: ${error}`;
      });
    }

    const container = successfulBans.length > 0
      ? ui.createSuccessMessage('Users Banned', resultMessage)
      : ui.createErrorMessage('Ban Failed', resultMessage);

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Log the action
    Logger.info(
      `Staff member ${ctx.user.tag} (${ctx.user.id}) banned ${successfulBans.length}/${allUsers.length} users from call ${callId}${durationText}`,
    );
  }
}
