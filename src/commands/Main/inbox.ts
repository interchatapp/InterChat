import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { Pagination } from '#src/modules/Pagination.js';
import UserDbService from '#src/services/UserDbService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

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
    await showInbox(ctx, {
      userDbService: this.userDbService,
      showOlder: true,
      ephemeral: true,
    });
  }
}

export async function showInbox(
  ctx: Context | ComponentContext,
  opts?: { userDbService?: UserDbService; showOlder?: boolean; ephemeral?: boolean },
) {
  const userDbService = opts?.userDbService ?? new UserDbService();
  const userData = await userDbService.getUser(ctx.user.id);
  const inboxLastRead = userData?.inboxLastReadDate || new Date();

  const announcements = !opts?.showOlder
    ? await db.announcement.findMany({
      where: { createdAt: { gt: inboxLastRead } },
      take: 10,
      orderBy: { createdAt: 'desc' },
    })
    : await db.announcement.findMany({
      where: { createdAt: { lt: inboxLastRead } },
      take: 50, // limit to 50 older announcements
      orderBy: { createdAt: 'desc' },
    });

  const components = !opts?.showOlder
    ? [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('inbox', 'viewOlder').toString())
          .setLabel('View Older')
          .setStyle(ButtonStyle.Secondary),
      ),
    ]
    : [];

  if (announcements.length === 0) {
    const embed = new InfoEmbed()
      .setTitle(':tada: All caught up!')
      .setDescription(
        `I'll let you know when there's more. But for now, there's only Chipi here: ${getEmoji('chipi_smile', ctx.client)}`,
      );
    await ctx.reply({ embeds: [embed], components });
    return;
  }

  new Pagination(ctx.client, { hiddenButtons: ['search', 'select'] })
    .addPages(
      announcements.map((announcement) => ({
        components,
        embeds: [
          new InfoEmbed()
            .setTitle(announcement.title)
            .setDescription(announcement.content)
            .setThumbnail(announcement.thumbnailUrl)
            .setImage(announcement.imageUrl)
            .setTimestamp(announcement.createdAt),
        ],
      })),
    )
    .run(ctx, { ephemeral: opts?.ephemeral });

  await userDbService.updateUser(ctx.user.id, {
    inboxLastReadDate: new Date(),
    name: ctx.user.username,
    image: ctx.user.avatarURL(),
  });
}
