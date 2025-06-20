import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import { sendToHub } from '#src/utils/hub/utils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { t } from '#utils/Locale.js';
import { ApplicationCommandOptionType, AutocompleteInteraction } from 'discord.js';
import HubCommand, { hubOption } from './index.js';

export default class HubSetNsfwSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'set-nsfw',
      description: '🔞 Set the NSFW status of a hub you manage.',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'enabled',
          description: 'Whether to mark the hub as NSFW (true) or SFW (false)',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const locale = await fetchUserLocale(ctx.user.id);
    const hubName = ctx.options.getString('hub', true);
    const nsfwEnabled = ctx.options.getBoolean('enabled', true);

    // Find the hub
    const [hub] = await this.hubService.findHubsByName(hubName);

    if (!hub) {
      await ctx.replyEmbed('hub.notFound_mod', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    // Check if user is a manager
    if (!(await hub.isManager(ctx.user.id))) {
      await ctx.replyEmbed('hub.notManager', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    // Check if the NSFW status is already set to the desired value
    if (hub.data.nsfw === nsfwEnabled) {
      const currentStatus = nsfwEnabled ? 'NSFW' : 'SFW';
      await ctx.reply({
        content: t('hub.manage.nsfwAlreadySet', locale, {
          emoji: ctx.getEmoji('info_icon'),
          hub: hub.data.name,
          status: currentStatus,
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Update the hub NSFW status
    await hub.update({ nsfw: nsfwEnabled });
    const newStatus = nsfwEnabled ? 'NSFW' : 'SFW';

    // Send success message
    await ctx.reply({
      content: t('hub.manage.setNsfw.success', locale, {
        emoji: nsfwEnabled ? ctx.getEmoji('tick_icon') : ctx.getEmoji('tick_icon'),
        hub: hub.data.name,
        status: newStatus,
      }),
      flags: ['Ephemeral'],
    });

    // Send announcement to the hub
    const announcementEmoji = nsfwEnabled ? '🔞' : '🛡️';
    const announcement = t('hub.manage.setNsfw.announcement', locale, {
      emoji: announcementEmoji,
      status: newStatus,
      description: nsfwEnabled
        ? t('hub.manage.toggleNsfw.announcementDescription.nsfw', locale)
        : t('hub.manage.toggleNsfw.announcementDescription.sfw', locale),
    });

    await sendToHub(hub.id, {
      username: hub.data.name ?? 'InterChat Hub Announcement',
      avatarURL: hub.data.iconUrl,
      content: announcement,
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    // Use the same autocomplete logic as other hub management commands
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
