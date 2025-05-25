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
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from 'discord.js';

import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import {
  ActiveCallData,
  CallMessage,
  CallParticipants,
  CallService,
} from '#src/services/CallService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { checkIfStaff } from '#src/utils/Utils.js';
import { RedisKeys } from '#utils/Constants.js';
import Logger from '#utils/Logger.js';
import { getRedis } from '#utils/Redis.js';

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
    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

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
  private async displayCallReport(
    ctx: Context | ComponentContext,
    callData: ActiveCallData,
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
        `Reported on ${time(new Date(reportData.timestamp), TimestampStyles.RelativeTime)}`,
        'alert_icon',
      ),
    );

    // Add call metadata section
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        **Report Reason:** ${reportData.reason}
        **Reporter:** <@${reportData.reporterId}> (${reportData.reporterId})
        **Call ID:** \`${callData.callId}\`
        **Call Duration:** ${this.formatDuration(reportData.callDuration || 0)}
        **Participants:** ${this.formatParticipants(callData.participants)}
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

    // Add messages section
    if (messages.length > 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## Message History (${startIdx + 1}-${endIdx} of ${messages.length})`,
        ),
      );

      for (const msg of pageMessages) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            stripIndents`
            **<@${msg.authorId}>** (${msg.authorId}) - ${time(new Date(msg.timestamp), TimestampStyles.RelativeTime)}
            ${msg.content || '*[No text content]*'}
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
                new CustomID('view_call:prev', [callData.callId, page.toString()]).toString(),
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
                new CustomID('view_call:next', [callData.callId, page.toString()]).toString(),
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
        .setCustomId(new CustomID('view_call:dismiss', [callData.callId]).toString())
        .setLabel('Dismiss Report')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(new CustomID('view_call:warn', [callData.callId]).toString())
        .setLabel('Warn Users')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(new CustomID('view_call:ban', [callData.callId]).toString())
        .setLabel('Ban Users')
        .setStyle(ButtonStyle.Danger),
    );

    // Send or update the message
    try {
      const components = [container.toJSON(), actionRow];
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
    callData: ActiveCallData,
    reportData: CallReportData,
    messages: CallMessage[],
  ): Promise<void> {
    try {
      // Create pagination manager for messages
      const pagination = new PaginationManager<CallMessage>({
        client: ctx.client,
        identifier: `view_call_${callData.callId}`,
        items: messages,
        itemsPerPage: 5, // 5 messages per page
        contentGenerator: (pageIndex, messagesOnPage, totalPages, totalMessages) =>
          this.generateCallReportPage(
            callData,
            reportData,
            messagesOnPage,
            pageIndex,
            ctx.client,
            totalMessages,
          ),
        idleTimeout: 300000, // 5 minutes
        ephemeral: false,
        deleteOnEnd: false,
      });

      // Start pagination
      await pagination.start(ctx);

      // Add action buttons after pagination is started
      // This is handled separately since PaginationManager doesn't support custom buttons directly
    }
    catch (error) {
      Logger.error('Error displaying call report with pagination:', error);

      // Fall back to the old method if pagination fails
      await this.displayCallReport(ctx, callData, reportData, messages);
    }
  }

  /**
   * Generate a page for the call report
   */
  private generateCallReportPage(
    callData: ActiveCallData,
    reportData: CallReportData,
    messagesOnPage: CallMessage[],
    pageIndex: number,
    client: Client,
    totalMessages: number,
  ): ContainerBuilder {
    const ui = new UIComponents(client);
    const container = new ContainerBuilder();

    // Add header with call information
    container.addTextDisplayComponents(
      ui.createHeader(
        'Call Report Review',
        `Reported on ${time(new Date(reportData.timestamp), TimestampStyles.RelativeTime)}`,
        'alert_icon',
      ),
    );

    // Add call metadata section
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        **Report Reason:** ${reportData.reason}
        **Reporter:** <@${reportData.reporterId}> (${reportData.reporterId})
        **Call ID:** \`${callData.callId}\`
        **Call Duration:** ${this.formatDuration(reportData.callDuration || 0)}
        **Participants:** ${this.formatParticipants(callData.participants)}
        `,
      ),
    );
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Small),
    );

    // Add message display
    const startIdx = pageIndex * 5 + 1;
    const endIdx = startIdx + messagesOnPage.length - 1;

    // Add messages section
    if (totalMessages > 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## Message History (${startIdx}-${endIdx} of ${totalMessages})`,
        ),
      );

      for (const msg of messagesOnPage) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            stripIndents`
            **<@${msg.authorId}>** (${msg.authorId}) - ${time(new Date(msg.timestamp), TimestampStyles.RelativeTime)}
            ${msg.content || '*[No text content]*'}
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

    return container;
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
   * Format participants information
   */
  private formatParticipants(participants: CallParticipants[]): string {
    return participants
      .map(
        (p, index) =>
          `Server ${index + 1}: ${p.users.size} users from <#${p.channelId}> (${p.guildId})`,
      )
      .join('\n');
  }

  @RegisterInteractionHandler('view_call', 'next')
  async handleNextPage(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId, currentPageStr] = ctx.customId.args;
    const currentPage = parseInt(currentPageStr, 10);
    const nextPage = currentPage + 1;

    // Get call data
    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

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
    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

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

  @RegisterInteractionHandler('view_call', 'warn')
  async handleWarnUsers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find users
    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

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
      if (p.users instanceof Set) {
        p.users.forEach((u) => allUsers.push(u));
      }
      else if (Array.isArray(p.users)) {
        allUsers.push(...(p.users as string[]));
      }
    });

    // Mark the report as resolved with warnings
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
    parsedReport.status = 'warned';
    parsedReport.resolvedBy = ctx.user.id;
    parsedReport.resolvedAt = Date.now();
    parsedReport.warnedUsers = allUsers;

    await redis.set(reportKey, JSON.stringify(parsedReport));

    // TODO: Implement actual warning system integration

    // Notify the staff member
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Users Warned',
      `Warnings have been issued to ${allUsers.length} users from call ${callId}.`,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Log the action
    Logger.info(
      `Staff member ${ctx.user.tag} (${ctx.user.id}) warned ${allUsers.length} users from call ${callId}`,
    );
  }

  @RegisterInteractionHandler('view_call', 'ban')
  async handleBanUsers(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [callId] = ctx.customId.args;

    // Get call data to find users
    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

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
      if (p.users instanceof Set) {
        p.users.forEach((u) => allUsers.push(u));
      }
      else if (Array.isArray(p.users)) {
        allUsers.push(...(p.users as string[]));
      }
    });

    // Mark the report as resolved with bans
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
    parsedReport.status = 'banned';
    parsedReport.resolvedBy = ctx.user.id;
    parsedReport.resolvedAt = Date.now();
    parsedReport.bannedUsers = allUsers;

    await redis.set(reportKey, JSON.stringify(parsedReport));

    // TODO: Implement actual ban system integration

    // Notify the staff member
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Users Banned',
      `${allUsers.length} users from call ${callId} have been banned from using InterChat.`,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Log the action
    Logger.info(
      `Staff member ${ctx.user.tag} (${ctx.user.id}) banned ${allUsers.length} users from call ${callId}`,
    );
  }
}
