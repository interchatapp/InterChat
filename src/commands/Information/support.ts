/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import {
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from 'discord.js';

/**
 * Support command using the InterChat v5 design system
 */
export default class SupportCommand extends BaseCommand {
  constructor() {
    super({
      name: 'support',
      description: '🆘 Get help with InterChat',
      types: { slash: true },
      options: [
        {
          name: 'category',
          description: 'What do you need help with?',
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: '🔌 Connection Issues', value: 'connection' },
            { name: '🌐 Hub Management', value: 'hub' },
            { name: '🔒 Permissions', value: 'permissions' },
            { name: '✨ Premium Features', value: 'premium' },
            { name: '❓ Other Issue', value: 'other' },
          ],
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const category = ctx.options.getString('category');

    if (category) {
      return this.showCategoryHelp(ctx, category, ui);
    }

    // Create main support menu
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('InterChat Support', 'How can we help you today?', 'call_icon'),
    );

    // Add common issues section
    container.addTextDisplayComponents(
      ui.createSection('Common Issues', 'Select a category to get help with specific issues:'),
    );

    // Add issue categories as sections
    const categories = [
      {
        id: 'connection',
        name: 'Connection Issues',
        emoji: '🔌',
        description: 'Problems with connecting channels or servers',
      },
      {
        id: 'hub',
        name: 'Hub Management',
        emoji: '🌐',
        description: 'Issues with creating or managing hubs',
      },
      {
        id: 'permissions',
        name: 'Permissions',
        emoji: '🔒',
        description: 'Help with bot or user permissions',
      },
      {
        id: 'premium',
        name: 'Premium Features',
        emoji: '✨',
        description: 'Questions about premium features',
      },
      {
        id: 'other',
        name: 'Other Issues',
        emoji: '❓',
        description: 'Any other problems not listed above',
      },
    ];

    for (const cat of categories) {
      const section = new SectionBuilder();

      // Create category description
      const description = `### ${cat.emoji} ${cat.name}\n${cat.description}`;

      // Create button for this category
      const button = new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('support', 'category').setArgs(cat.id).toString())
        .setLabel('Get Help')
        .setStyle(ButtonStyle.Secondary);

      // Add to section
      section
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
        .setButtonAccessory(button);

      container.addSectionComponents(section);
    }

    // Add support server button
    ui.createActionButtons(container, {
      label: 'Join Support Server',
      url: Constants.Links.SupportInvite,
      emoji: 'discord_logo',
    });

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Show help for a specific category
   */
  private async showCategoryHelp(ctx: Context, categoryId: string, ui: UIComponents) {
    // Create container for category help
    const container = new ContainerBuilder();

    // Get category details
    const categoryDetails = this.getCategoryDetails(categoryId);

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        `${categoryDetails.emoji} ${categoryDetails.name}`,
        'Follow these steps to resolve your issue:',
      ),
    );

    // Add troubleshooting steps
    container.addTextDisplayComponents(
      ui.createSection('Troubleshooting Steps', categoryDetails.steps.join('\n\n')),
    );

    // Add FAQ section if available
    if (categoryDetails.faq && categoryDetails.faq.length > 0) {
      container.addTextDisplayComponents(ui.createSection('Frequently Asked Questions', ''));

      for (const [question, answer] of categoryDetails.faq) {
        container.addTextDisplayComponents(ui.createSubsection(question, answer));
      }
    }

    // Add buttons
    ui.createActionButtons(
      container,
      {
        label: 'Back to Support Menu',
        customId: new CustomID().setIdentifier('support', 'main').toString(),
        emoji: 'previous_icon',
      },
      {
        label: 'View Documentation',
        url: `${Constants.Links.Website}/docs/${categoryId}`,
        emoji: '📚',
      },
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Get details for a support category
   */
  private getCategoryDetails(categoryId: string): {
    name: string;
    emoji: string;
    steps: string[];
    faq?: [string, string][];
  } {
    switch (categoryId) {
      case 'connection':
        return {
          name: 'Connection Issues',
          emoji: '🔌',
          steps: [
            '**1. Check Bot Permissions:**Make sure InterChat has the following permissions in your channel:\n- Send Messages\n- Embed Links\n- Attach Files\n- Manage Webhooks',
            '**2. Verify Webhook Setup:**Run `/diagnose` to check if webhooks are properly configured.',
            '**3. Reconnect Channel:**Try disconnecting and reconnecting your channel using `/connect`.',
            '**4. Server Settings:**Ensure your server settings allow webhooks and bot integrations.',
          ],
          faq: [
            [
              'Why are messages not appearing?',
              'This is usually due to webhook permissions or configuration issues. Run `/diagnose` to identify the problem.',
            ],
            [
              'Can I move my connection to another channel?',
              'Yes! First disconnect from the current channel with `/disconnect`, then connect the new channel with `/connect`.',
            ],
            [
              'Why do I see "Unknown Webhook" errors?',
              'This happens when a webhook has been deleted. Try reconnecting your channel to create a new webhook.',
            ],
          ],
        };
      case 'hub':
        return {
          name: 'Hub Management',
          emoji: '🌐',
          steps: [
            '**1. Hub Creation**To create a hub, use `/hub create` and follow the prompts.',
            '**2. Hub Settings**Manage your hub settings with `/hub config <subcommand>`, and `/hub edit`.',
            '**3. Hub Moderation**Use `/hub moderator` commands to manage moderators in your hub.',
            '**4. Hub Visibility**Toggle your hub\'s privacy with `/hub privacy`.',
          ],
          faq: [
            [
              'How many hubs can I create?',
              'Free users can create 2 hubs, voters can create 4, Premium subscribers can create 5, and Professional subscribers have unlimited hubs.',
            ],
            [
              'Can I transfer hub ownership?',
              'Yes, use `/hub transfer @user` to transfer ownership to another user.',
            ],
            [
              'How do I invite servers to my hub?',
              'Use `/hub invite` to generate an invite link that other servers can use to join your hub.',
            ],
          ],
        };
      // Add other categories as needed
      default:
        return {
          name: 'General Support',
          emoji: '❓',
          steps: [
            `**1. Check Documentation**Visit our [documentation](${Constants.Links.Website}/docs) for comprehensive guides.`,
            '**2. Try the Tutorial**Run `/tutorial` to access interactive tutorials for common tasks.',
            `**3. Join Support Server**Join our [support server](${Constants.Links.SupportInvite}) for direct assistance.`,
          ],
        };
    }
  }

  @RegisterInteractionHandler('support', 'main')
  async handleMainButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    // Show the main support menu again
    const ui = new UIComponents(ctx.client);

    // Create main support menu
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('InterChat Support', 'How can we help you today?', 'question_icon'),
    );

    // Add common issues section
    container.addTextDisplayComponents(
      ui.createSection('Common Issues', 'Select a category to get help with specific issues:'),
    );

    // Add issue categories as sections
    const categories = [
      {
        id: 'connection',
        name: 'Connection Issues',
        emoji: '🔌',
        description: 'Problems with connecting channels or servers',
      },
      {
        id: 'hub',
        name: 'Hub Management',
        emoji: '🌐',
        description: 'Issues with creating or managing hubs',
      },
      {
        id: 'permissions',
        name: 'Permissions',
        emoji: '🔒',
        description: 'Help with bot or user permissions',
      },
      {
        id: 'premium',
        name: 'Premium Features',
        emoji: '✨',
        description: 'Questions about premium features',
      },
      {
        id: 'other',
        name: 'Other Issues',
        emoji: '❓',
        description: 'Any other problems not listed above',
      },
    ];

    for (const cat of categories) {
      const section = new SectionBuilder();

      // Create category description
      const description = `### ${cat.emoji} ${cat.name}\n${cat.description}`;

      // Create button for this category
      const button = new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('support', 'category').setArgs(cat.id).toString())
        .setLabel('Get Help')
        .setStyle(ButtonStyle.Secondary);

      // Add to section
      section
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
        .setButtonAccessory(button);

      container.addSectionComponents(section);
    }

    // Add support server button
    ui.createActionButtons(container, {
      label: 'Join Support Server',
      url: Constants.Links.SupportInvite,
      emoji: 'discord_logo',
    });

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('support', 'category')
  async handleCategoryButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [categoryId] = ctx.customId.args;
    const ui = new UIComponents(ctx.client);

    await this.showCategoryHelp(ctx, categoryId, ui);
  }
}
