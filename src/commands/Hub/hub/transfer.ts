import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ButtonInteraction,
  Colors,
} from 'discord.js';
import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';
import { t } from '#src/utils/Locale.js';

const COLLECTOR_TIMEOUT = 30_000; // 30 seconds

export default class HubTransferSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'transfer',
      description: '👑 Transfer ownership of your hub to another user',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user who will become the new owner',
          required: true,
        },
      ],
    });
  }

  public async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub', true);
    const newOwner = await ctx.options.getUser('user');
    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    const locale = await ctx.getLocale();

    if (
      !hub ||
      !(await runHubRoleChecksAndReply(hub, ctx, {
        checkIfOwner: true,
      }))
    ) {
      return;
    }

    if (!newOwner) {
      await ctx.replyEmbed('hub.transfer.invalidUser', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    if (newOwner.id === ctx.user.id) {
      await ctx.replyEmbed('hub.transfer.selfTransfer', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    if (newOwner.bot) {
      await ctx.replyEmbed('hub.transfer.botUser', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const confirmButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Confirm').setCustomId('confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setLabel('Cancel').setCustomId('cancel').setStyle(ButtonStyle.Secondary),
    );

    const reply = await ctx.reply({
      embeds: [
        {
          description: t('hub.transfer.confirm', locale, {
            hub: hub.data.name,
            newOwner: newOwner.toString(),
          }),
          color: Colors.Red,
        },
      ],
      components: [confirmButtons],
      flags: ['Ephemeral'],
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === ctx.user.id,
      time: COLLECTOR_TIMEOUT,
      max: 1,
    });

    collector.on('collect', async (interaction: ButtonInteraction) => {
      if (interaction.customId === 'cancel') {
        await interaction.update({
          embeds: [
            {
              color: Colors.Red,
              description: t('hub.transfer.cancelled', locale, {
                emoji: ctx.getEmoji('x_icon'),
              }),
            },
          ],
          components: [],
        });
        return;
      }

      // Transfer ownership
      await hub.update({ ownerId: newOwner.id });
      // Add previous owner as a manager
      await hub.moderators.add(ctx.user.id, 'MANAGER');

      await interaction.update({
        embeds: [
          {
            color: Colors.Green,
            description: t('hub.transfer.success', locale, {
              emoji: ctx.getEmoji('tick_icon'),
              hub: hub.data.name,
              newOwner: newOwner.toString(),
            }),
          },
        ],
        components: [],
      });
    });

    collector.on('end', async (collected) => {
      if (collected.size === 0) {
        await reply.edit({
          embeds: [
            {
              color: Colors.Red,
              description: t('hub.transfer.timeout', locale, {
                emoji: ctx.getEmoji('x_icon'),
              }),
            },
          ],
          components: [],
        });
      }
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
