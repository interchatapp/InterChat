import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import UserDbService from '#src/services/UserDbService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
  time,
} from 'discord.js';

export default class InboxCommand extends BaseCommand {
  private readonly userDbService = new UserDbService();

  constructor() {
    super({
      name: 'inbox',
      description: 'Check your inbox for latest important updates & announcements',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    await showInbox(ctx, { userDbService: this.userDbService });
  }

  @RegisterInteractionHandler('inbox', 'viewOlder')
  async handleViewOlder(ctx: ComponentContext) {
    await ctx.deferUpdate();
    const container = await buildInboxContainer(ctx, {
      userDbService: this.userDbService,
      showOlder: true,
    });

    if (container) {
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('inbox', 'next')
  async handleNextPage(ctx: ComponentContext) {
    await ctx.deferUpdate();
    const currentPage = parseInt(ctx.customId.args[0] || '0', 10);
    const container = await buildInboxContainer(ctx, {
      userDbService: this.userDbService,
      showOlder: ctx.customId.args[1] === 'older',
      page: currentPage + 1,
    });

    if (container) {
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('inbox', 'prev')
  async handlePrevPage(ctx: ComponentContext) {
    await ctx.deferUpdate();
    const currentPage = parseInt(ctx.customId.args[0] || '0', 10);
    const container = await buildInboxContainer(ctx, {
      userDbService: this.userDbService,
      showOlder: ctx.customId.args[1] === 'older',
      page: Math.max(0, currentPage - 1),
    });

    if (container) {
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }
}

/**
 * Builds the inbox container with announcements and pagination
 */
export async function buildInboxContainer(
  ctx: Context | ComponentContext,
  opts?: {
    userDbService?: UserDbService;
    showOlder?: boolean;
    page?: number;
  },
): Promise<ContainerBuilder | null> {
  const userDbService = opts?.userDbService ?? new UserDbService();
  const userData = await userDbService.getUser(ctx.user.id);
  const inboxLastRead = userData?.inboxLastReadDate || new Date();
  const currentPage = opts?.page || 0;
  const itemsPerPage = 1; // Show one announcement per page

  // Create UI components helper
  const ui = new UIComponents(ctx.client);

  // Fetch announcements based on whether we're showing new or older ones
  const announcements = !opts?.showOlder
    ? await db.announcement.findMany({
      where: { createdAt: { gt: inboxLastRead } },
      take: 50,
      orderBy: { createdAt: 'desc' },
    })
    : await db.announcement.findMany({
      where: { createdAt: { lt: inboxLastRead } },
      take: 50, // limit to 50 older announcements
      orderBy: { createdAt: 'desc' },
    });

  // If there are no announcements, show a message
  if (announcements.length === 0) {
    const container = ui.createInfoMessage(
      '📬 All caught up!',
      `I'll let you know when there's more. But for now, there's only Chipi here: ${getEmoji('chipi_smile', ctx.client)}`,
    );

    // Add "View Older" button if we're not already viewing older announcements
    if (!opts?.showOlder) {
      ui.createActionButtons(container, {
        label: 'View Older',
        customId: new CustomID().setIdentifier('inbox', 'viewOlder').toString(),
        emoji: '🕒',
      });
    }

    return container;
  }

  // Calculate pagination
  const totalPages = Math.ceil(announcements.length / itemsPerPage);
  const validPage = Math.min(currentPage, totalPages - 1);
  const startIndex = validPage * itemsPerPage;
  const currentAnnouncements = announcements.slice(startIndex, startIndex + itemsPerPage);
  const announcement = currentAnnouncements[0]; // Get the current announcement

  // Create container for Components v2
  const container = new ContainerBuilder();

  // Add header
  container.addTextDisplayComponents(
    ui.createHeader(
      '📬 InterChat Inbox',
      opts?.showOlder ? 'Viewing older announcements' : 'Latest announcements and updates',
    ),
  );

  // Add separator
  ui.addSeparator(container);

  // Add announcement content
  const announcementContent = new TextDisplayBuilder().setContent(
    `## ${announcement.title}\n${announcement.content}\n\n*Posted on ${time(announcement.createdAt)}*`,
  );
  container.addTextDisplayComponents(announcementContent);

  // Add media components if available
  if (announcement.thumbnailUrl || announcement.imageUrl) {
    if (announcement.imageUrl) {
      const mediaGallery = new MediaGalleryBuilder();
      const mediaItem = new MediaGalleryItemBuilder()
        .setURL(announcement.imageUrl)
        .setDescription('Announcement image');

      mediaGallery.addItems(mediaItem);
      container.addMediaGalleryComponents(mediaGallery);
    }

    if (announcement.thumbnailUrl) {
      const mediaGallery = new MediaGalleryBuilder();
      const mediaItem = new MediaGalleryItemBuilder()
        .setURL(announcement.thumbnailUrl)
        .setDescription('Announcement thumbnail');

      mediaGallery.addItems(mediaItem);
      container.addMediaGalleryComponents(mediaGallery);
    }
  }

  // Add pagination buttons
  const paginationRow = new ActionRowBuilder<ButtonBuilder>();

  // Previous page button
  const prevButton = new ButtonBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('inbox', 'prev')
        .setArgs(validPage.toString())
        .setArgs(opts?.showOlder ? 'older' : 'new')
        .toString(),
    )
    .setLabel('Previous')
    .setEmoji(getEmoji('arrow_left', ctx.client))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(validPage === 0);

  // Page indicator
  const pageIndicator = new ButtonBuilder()
    .setCustomId('page_indicator')
    .setLabel(`${validPage + 1}/${totalPages}`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  // Next page button
  const nextButton = new ButtonBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('inbox', 'next')
        .setArgs(validPage.toString())
        .setArgs(opts?.showOlder ? 'older' : 'new')
        .toString(),
    )
    .setLabel('Next')
    .setEmoji(getEmoji('arrow_right', ctx.client))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(validPage >= totalPages - 1);

  paginationRow.addComponents(prevButton, pageIndicator, nextButton);

  // Add "View Older" button if we're not already viewing older announcements
  if (!opts?.showOlder) {
    const viewOlderButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('inbox', 'viewOlder').toString())
      .setLabel('View Older')
      .setEmoji('🕒')
      .setStyle(ButtonStyle.Secondary);

    paginationRow.addComponents(viewOlderButton);
  }

  container.addActionRowComponents(paginationRow);

  // Update the user's last read date if viewing new announcements
  if (!opts?.showOlder) {
    await userDbService.updateUser(ctx.user.id, {
      inboxLastReadDate: new Date(),
      name: ctx.user.username,
      image: ctx.user.avatarURL(),
    });
  }

  return container;
}

/**
 * Shows the inbox with announcements
 */
export async function showInbox(
  ctx: Context | ComponentContext,
  opts?: {
    userDbService?: UserDbService;
    showOlder?: boolean;
    ephemeral?: boolean;
    page?: number;
  },
) {
  const container = await buildInboxContainer(ctx, opts);

  if (container) {
    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
  }
}
