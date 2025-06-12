import HubCommand from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubService } from '#src/services/HubService.js';
import UserDbService from '#src/services/UserDbService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { t } from '#src/utils/Locale.js';
import { escapeRegexChars, fetchUserLocale } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import Constants from '#src/utils/Constants.js';

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

    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await ctx.getLocale();
    const hasVoted = await new UserDbService().userVotedToday(ctx.user.id);
    if (!hasVoted) {
      await ctx.reply({
        content: t('hub.welcome.voterOnly', locale, {
          emoji: ctx.getEmoji('topggSparkles'),
        }),
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
            .setPlaceholder(t('hub.welcome.placeholder', locale))
            .setValue(hub.data.welcomeMessage ?? '')
            .setMaxLength(1000)
            .setRequired(false),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('hub_welcome')
  async handleWelcomeModal(ctx: ComponentContext) {
    const [hubId] = ctx.customId.args;
    const welcomeMessage = ctx.getModalFieldValue('welcome_message') ?? null;
    const locale = await fetchUserLocale(ctx.user.id);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      await ctx.reply({
        content: t('hub.notFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
          hubs_link: `${Constants.Links.Website}/hubs}`,
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    await hub.update({ welcomeMessage });

    const tick = getEmoji('tick_icon', ctx.client);

    await ctx.reply({
      content: welcomeMessage
        ? `${(t('hub.welcome.set', locale), { emoji: tick })}`
        : `${(t('hub.welcome.removed', locale), { emoji: tick })}`,
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
