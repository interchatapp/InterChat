import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { DonationManager } from '#src/lib/donations/core/DonationManager.js';
import { PremiumService } from '#src/lib/donations/core/PremiumService.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { HubService } from '#src/services/HubService.js';
import Constants from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { validatePremiumHubName } from '#src/utils/HubNameUtils.js';
import Logger from '#src/utils/Logger.js';
import db from '#utils/Db.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';
import HubCommand from './index.js';

const hubOption = {
  name: 'hub',
  description: 'The hub to rename.',
  type: ApplicationCommandOptionType.String,
  required: true,
  autocomplete: true,
} as const;

const nameOption = {
  name: 'name',
  description: 'The new name (1-50 characters).',
  type: ApplicationCommandOptionType.String,
  required: true,
  max_length: 50,
} as const;

/**
 * Ergonomic command for hub name customization
 * Usage: /rename hub:MyHub name:New Display Name
 * Or: i.rename (interactive)
 */
export default class HubRenameSubcommand extends BaseCommand {
  private readonly hubService = new HubService();
  private readonly premiumService: PremiumService;

  constructor() {
    super({
      name: 'rename',
      description: '✨ Rename your hub (Premium)',
      types: { slash: true, prefix: true },
      options: [hubOption, nameOption],
      aliases: ['rn'],
    });

    // Initialize premium service with shared instances
    // Use existing pattern from codebase for manager instantiation
    const donationManager = new DonationManager();
    const cacheManager = new CacheManager();
    this.premiumService = new PremiumService(donationManager, cacheManager);
  }

  async execute(ctx: Context) {
    const startTime = Date.now();

    try {
      const hubName = ctx.options.getString('hub', true);
      const customName = ctx.options.getString('name', true);

      // Find the hub
      const hubs = await this.hubService.findHubsByName(hubName);
      const hub = hubs.at(0);

      if (!hub) {
        await ctx.replyEmbed('hub.notFound', {
          t: {
            emoji: getEmoji('x_icon', ctx.client),
            hubs_link: 'https://interchat.app/hubs',
          },
          flags: ['Ephemeral'],
        });
        return;
      }

      // Check if user is the hub owner
      if (!(await runHubRoleChecksAndReply(hub, ctx, { checkIfOwner: true }))) {
        return;
      }

      // Check premium status
      const hasPremium = await this.premiumService.hasFeature(ctx.user.id, 'hub_rename');
      if (!hasPremium) {
        await ctx.replyEmbed('premium.featureRequired', {
          t: {
            link: Constants.Links.Donate,
            emoji: getEmoji('topggSparkles', ctx.client),
          },
          flags: ['Ephemeral'],
        });
        return;
      }

      // Validate the new name
      const validation = validatePremiumHubName(customName);
      if (!validation.valid) {
        await ctx.replyEmbed('hub.rename.invalidName', {
          t: {
            error: validation.error ?? 'Unknown Error',
            emoji: getEmoji('x_icon', ctx.client),
          },
          flags: ['Ephemeral'],
        });
        return;
      }

      // Sanitize the new name

      // Check if a hub with this name already exists
      const existingHub = await db.hub.findUnique({
        where: { name: customName },
        select: { id: true },
      });

      if (existingHub && existingHub.id !== hub.id) {
        await ctx.replyEmbed('hub.rename.nameTaken', {
          t: {
            name: customName,
            emoji: getEmoji('x_icon', ctx.client),
          },
          flags: ['Ephemeral'],
        });
        return;
      }

      // Update the hub name
      await db.hub.update({
        where: { id: hub.id },
        data: { name: customName },
      });

      // Success response
      await ctx.replyEmbed('hub.rename.success', {
        t: {
          tick: getEmoji('tick_icon', ctx.client),
          oldName: hub.data.name,
          newName: customName,
          info: getEmoji('info_icon', ctx.client),
        },
      });

      // Log performance
      const responseTime = Date.now() - startTime;
      Logger.info(`Hub rename completed in ${responseTime}ms`, {
        userId: ctx.user.id,
        hubId: hub.id,
        customName,
        responseTime,
      });
    }
    catch (error) {
      Logger.error('Failed to rename hub', error);
      await ctx.replyEmbed('errors.commandError', {
        t: {
          emoji: getEmoji('x_icon', ctx.client),
          errorId: ctx.interaction.id,
          support_invite: 'https://discord.gg/interchat',
        },
        flags: ['Ephemeral'],
      });
    }
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
