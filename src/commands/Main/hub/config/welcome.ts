import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { CustomID } from '#utils/CustomID.js';
import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import UserDbService from '#src/services/UserDbService.js';
import Constants from '#src/utils/Constants.js';
import HubCommand from '#src/commands/Main/hub/index.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { escapeRegexChars } from '#src/utils/Utils.js';

export default class HubConfigWelcomeSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'welcome',
      description: '📝 Set a custom welcome message for new members (Voter Only)',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'hub',
          description: 'The hub to configure',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
      ],
    });
  }

  private readonly hubService = new HubService();

  async execute(ctx: Context): Promise<void> {
    const hubName = ctx.options.getString('hub', true);
    const hub = (await this.hubService.findHubsByName(hubName)).at(0);

    if (!hub) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Hub not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!(await hub.isMod(ctx.user.id))) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} You need to be a hub moderator to configure welcome messages.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const hasVoted = await new UserDbService().userVotedToday(ctx.user.id);
    if (!hasVoted) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Custom welcome messages are a voter-only perk! Vote at ${Constants.Links.Vote} to unlock this feature.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(new CustomID('hub_welcome').setArgs(hub.id).toString())
      .setTitle('Set Hub Welcome Message')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('welcome_message')
            .setLabel('Welcome Message')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(
              'Welcome {user} to {hubName}! 🎉\nMake yourself at home, we now have {totalConnections} servers!',
            )
            .setValue(hub.data.welcomeMessage ?? '')
            .setMaxLength(1000)
            .setRequired(false),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('hub_welcome')
  async handleWelcomeModal(interaction: ModalSubmitInteraction) {
    const [hubId] = CustomID.parseCustomId(interaction.customId).args;
    const welcomeMessage = interaction.fields.getTextInputValue('welcome_message') ?? null;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      await interaction.reply({
        content: `${getEmoji('x_icon', interaction.client)} Hub not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await hub.update({ welcomeMessage });

    await interaction.reply({
      content: welcomeMessage
        ? `${getEmoji('tick_icon', interaction.client)} Welcome message updated successfully!`
        : `${getEmoji('tick_icon', interaction.client)} Welcome message removed.`,
      flags: ['Ephemeral'],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getModeratedHubs(
      focusedValue,
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }
}
