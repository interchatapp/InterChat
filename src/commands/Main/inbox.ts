import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import UserDbService from '#src/services/UserDbService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';

import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
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
import { Announcement } from '#src/generated/prisma/client/index.js';

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
 * Fetches announcements based on the user's last read date.
 */
async function fetchAnnouncements(inboxLastRead: Date, showOlder?: boolean) {
  const where = showOlder
    ? { createdAt: { lt: inboxLastRead } }
    : { createdAt: { gt: inboxLastRead } };

  return db.announcement.findMany({
    where,
    take: 50,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Creates the container for when there are no announcements.
 */
function createEmptyInboxContainer(
  ui: UIComponents,
  locale: supportedLocaleCodes,
  showOlder?: boolean,
): ContainerBuilder {
  const container = ui.createInfoMessage(
    t('inbox.empty.title', locale),
    t('inbox.empty.description', locale, {
      emoji: ui.getEmoji('chipi_smile'),
    }),
  );

  if (!showOlder) {
    ui.createActionButtons(container, {
      label: t('inbox.buttons.viewOlder', locale),
      customId: new CustomID().setIdentifier('inbox', 'viewOlder').toString(),
      emoji: '🕒',
    });
  }

  return container;
}

/**
 * Adds the announcement content to the container.
 */
function addAnnouncementContent(
  container: ContainerBuilder,
  announcement: Announcement,
  locale: supportedLocaleCodes,
) {
  const announcementContent = new TextDisplayBuilder().setContent(
    `## ${announcement.title}\n${announcement.content}\n\n*${t('inbox.postedOn', locale, { date: time(announcement.createdAt) })}*`,
  );
  container.addTextDisplayComponents(announcementContent);

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

/**
 * Adds pagination buttons to the container.
 */
function addPagination(
  container: ContainerBuilder,
  ui: UIComponents,
  locale: supportedLocaleCodes,
  page: number,
  totalPages: number,
  showOlder?: boolean,
) {
  const paginationRow = new ActionRowBuilder<ButtonBuilder>();

  const prevButton = new ButtonBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('inbox', 'prev')
        .setArgs(page.toString())
        .setArgs(showOlder ? 'older' : 'new')
        .toString(),
    )
    .setLabel(t('inbox.buttons.previous', locale))
    .setEmoji(ui.getEmoji('arrow_left'))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const pageIndicator = new ButtonBuilder()
    .setCustomId('page_indicator')
    .setLabel(`${page + 1}/${totalPages}`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  const nextButton = new ButtonBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('inbox', 'next')
        .setArgs(page.toString())
        .setArgs(showOlder ? 'older' : 'new')
        .toString(),
    )
    .setLabel(t('inbox.buttons.next', locale))
    .setEmoji(ui.getEmoji('arrow_right'))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  paginationRow.addComponents(prevButton, pageIndicator, nextButton);

  if (!showOlder) {
    const viewOlderButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('inbox', 'viewOlder').toString())
      .setLabel(t('inbox.buttons.viewOlder', locale))
      .setEmoji('🕒')
      .setStyle(ButtonStyle.Secondary);
    paginationRow.addComponents(viewOlderButton);
  }

  container.addActionRowComponents(paginationRow);
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
  const locale = await ctx.getLocale();
  const userDbService = opts?.userDbService ?? new UserDbService();
  const userData = await userDbService.getUser(ctx.user.id);
  const inboxLastRead = userData?.inboxLastReadDate || new Date();
  const currentPage = opts?.page || 0;
  const itemsPerPage = 1;

  const ui = new UIComponents(ctx.client);

  const announcements = await fetchAnnouncements(inboxLastRead, opts?.showOlder);

  if (announcements.length === 0) {
    return createEmptyInboxContainer(ui, locale, opts?.showOlder);
  }

  const totalPages = Math.ceil(announcements.length / itemsPerPage);
  const validPage = Math.min(currentPage, totalPages - 1);
  const startIndex = validPage * itemsPerPage;
  const currentAnnouncements = announcements.slice(startIndex, startIndex + itemsPerPage);
  const announcement = currentAnnouncements[0];

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    ui.createHeader(
      t('inbox.title', locale),
      opts?.showOlder ? t('inbox.subtitle.older', locale) : t('inbox.subtitle.new', locale),
    ),
  );

  ui.addSeparator(container);

  addAnnouncementContent(container, announcement, locale);

  addPagination(container, ui, locale, validPage, totalPages, opts?.showOlder);

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
