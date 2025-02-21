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

import Context from '#src/core/CommandContext/Context.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { getReplyMethod, handleError } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  type BaseMessageOptions,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ComponentType,
  type EmbedBuilder,
  InteractionCallbackResponse,
  type InteractionReplyOptions,
  InteractionResponse,
  Message,
  ModalBuilder,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

type PaginationInteraction = Exclude<RepliableInteraction, ModalSubmitInteraction>;

type ButtonEmojis = { back: string; next: string; search: string; select: string };

type RunOptions = { idle?: number; ephemeral?: boolean; deleteOnEnd?: boolean };

export class Pagination {
  private readonly pages: BaseMessageOptions[] = [];
  private readonly hiddenButtons: (keyof ButtonEmojis)[] = [];
  private readonly client: Client<true>;
  private customEmojis: ButtonEmojis;

  constructor(
    client: Client<true>,
    opts: {
      customEmojis?: ButtonEmojis;
      hiddenButtons?: (keyof ButtonEmojis)[];
    } = {},
  ) {
    if (opts.hiddenButtons) this.hiddenButtons = opts.hiddenButtons;

    this.client = client;
    this.customEmojis = opts.customEmojis ?? {
      back: getEmoji('arrow_left', client),
      next: getEmoji('arrow_right', client),
      search: getEmoji('search_icon', client),
      select: getEmoji('hash_icon', client),
    };
  }

  public addPage(page: BaseMessageOptions) {
    this.pages.push(page);
    return this;
  }

  public setEmojis(btnEmojis: ButtonEmojis) {
    this.customEmojis = btnEmojis;
    return this;
  }

  public addPages(pageArr: BaseMessageOptions[]) {
    for (const page of pageArr) {
      this.pages.push(page);
    }
    return this;
  }

  public getPage(index: number) {
    return this.pages[index];
  }

  private getPageContent(page: BaseMessageOptions): string {
    const searchableContent: string[] = [];

    if (page.content) {
      searchableContent.push(page.content);
    }

    const embedArray = Array.isArray(page.embeds) ? page.embeds : [page.embeds].filter(Boolean);

    for (const embed of embedArray) {
      if (!embed) continue;

      const embedData = (embed as EmbedBuilder).data || embed;

      if (embedData.title) searchableContent.push(embedData.title);
      if (embedData.description) searchableContent.push(embedData.description);
      if (embedData.author?.name) searchableContent.push(embedData.author.name);
      if (embedData.footer?.text) searchableContent.push(embedData.footer.text);

      if (embedData.fields?.length) {
        for (const field of embedData.fields) {
          searchableContent.push(field.name, field.value);
        }
      }
    }

    return searchableContent.join(' ').toLowerCase();
  }

  private async handlePageSelect(
    interaction: PaginationInteraction,
    totalPages: number,
  ): Promise<number | null> {
    const modal = new ModalBuilder().setCustomId('page_select_modal').setTitle('Go to Page');

    const pageInput = new TextInputBuilder()
      .setCustomId('page_number_input')
      .setLabel(`Enter page number (1-${totalPages})`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(4);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(pageInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    try {
      const modalSubmit = await interaction
        .awaitModalSubmit({ time: 30000, filter: (i) => i.customId === 'page_select_modal' })
        .catch((e) => {
          if (!e.message.includes('reason: time')) handleError(e);
          return null;
        });

      if (!modalSubmit) return null;

      const pageNumber = Number.parseInt(modalSubmit.fields.getTextInputValue('page_number_input'));

      if (Number.isNaN(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
        await modalSubmit.reply({
          content: `Please enter a valid page number between 1 and ${totalPages}`,
          flags: ['Ephemeral'],
        });
        return null;
      }

      await modalSubmit.reply({ content: `Going to page ${pageNumber}`, flags: ['Ephemeral'] });
      return pageNumber - 1; // Convert to 0-based index
    }
    catch (error) {
      if (
        !error.message.includes(
          'Collector received no interactions before ending with reason: time',
        )
      ) {
        Logger.error('Page selection error:', error);
      }
      return null;
    }
  }

  private async handleSearch(interaction: PaginationInteraction): Promise<number | null> {
    const modal = new ModalBuilder().setCustomId('search_modal').setTitle('Search Pages');

    const searchInput = new TextInputBuilder()
      .setCustomId('search_input')
      .setLabel('Enter search term')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(100);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(searchInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    try {
      const modalSubmit = await interaction
        .awaitModalSubmit({ time: 30000, filter: (i) => i.customId === 'search_modal' })
        .catch((e) => {
          if (!e.message.includes('reason: time')) handleError(e);
          return null;
        });

      if (!modalSubmit) return null;

      const searchTerm = modalSubmit.fields.getTextInputValue('search_input').toLowerCase();
      const results: { page: number; matches: number }[] = [];

      for (let i = 0; i < this.pages.length; i++) {
        const content = this.getPageContent(this.pages[i]);
        const matchCount = (content.match(new RegExp(searchTerm, 'g')) || []).length;

        if (matchCount > 0) {
          results.push({ page: i, matches: matchCount });
        }
      }

      if (results.length > 0) {
        results.sort((a, b) => b.matches - a.matches);

        const topResult = results[0];
        const totalMatches = results.reduce((sum, result) => sum + result.matches, 0);
        const otherResultsStr =
          results.length > 1
            ? `-# ${getEmoji('info', this.client)} Also found in the following pages: ${results.map((r) => r.page + 1).join(', ')}`
            : '';

        await modalSubmit.reply({
          content: stripIndents`
            **${getEmoji('search_icon', this.client)} Found ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} across ${results.length} page${results.length !== 1 ? 's' : ''}.**
            Jumping to page ${topResult.page + 1} with ${topResult.matches} match${topResult.matches !== 1 ? 'es' : ''}.
            
            ${otherResultsStr}`,
          flags: ['Ephemeral'],
        });

        return topResult.page;
      }

      await modalSubmit.reply({ content: 'No matches found', flags: ['Ephemeral'] });
      return null;
    }
    catch (error) {
      Logger.error('Search error:', error);
      return null;
    }
  }

  public async run(ctx: RepliableInteraction | Message | Context, options?: RunOptions) {
    if (this.pages.length < 1) {
      await this.sendReply(
        ctx,
        { content: `${getEmoji('tick', this.client)} No results to display!` },
        { flags: ['Ephemeral'] },
      );
      return;
    }

    let index = 0;
    const row = this.createButtons(index, this.pages.length);
    const resp = this.formatMessage(row, this.pages[index]);

    const listMessage = await this.sendReply(
      ctx,
      { ...resp, content: resp.content },
      { flags: options?.ephemeral ? ['Ephemeral'] : [] },
    );

    if (!listMessage) return;

    const col = listMessage.createMessageComponentCollector({
      idle: options?.idle || 60000,
      componentType: ComponentType.Button,
      filter: (i) => i.customId.startsWith('page_:'),
    });

    col.on('collect', async (i) => {
      if (i.customId === 'page_:search') {
        const newIndex = await this.handleSearch(i);
        if (newIndex !== null) {
          index = newIndex;
          const newRow = this.createButtons(index, this.pages.length);
          const newBody = this.formatMessage(newRow, this.pages[index]);
          await listMessage.edit(newBody);
        }
        return;
      }

      if (i.customId === 'page_:select') {
        const newIndex = await this.handlePageSelect(i, this.pages.length);
        if (newIndex !== null) {
          index = newIndex;
          const newRow = this.createButtons(index, this.pages.length);
          const newBody = this.formatMessage(newRow, this.pages[index]);
          await listMessage.edit(newBody);
        }
        return;
      }

      index = this.adjustIndex(i.customId, index);

      const newRow = this.createButtons(index, this.pages.length);
      const newBody = this.formatMessage(newRow, this.pages[index]);
      await i.update(newBody);
    });

    col.on('end', async (interactions) => {
      const interaction = interactions.first();

      if (!interaction) {
        if (options?.ephemeral) {

          (options?.deleteOnEnd
            ? listMessage.delete()
            : listMessage.edit({ components: [] })
          ).catch(() => null);
        }
        return;
      }

      let ackd = false;
      if (!interaction.replied && !interaction.deferred) {
        await interaction.update({ components: [] });
        ackd = true;
      }

      if (options?.deleteOnEnd) {
        await interaction.deleteReply();
      }
      else if (ackd === false) {
        await interaction.message.edit({ components: [] });
      }
    });
  }

  private async sendReply(
    ctx: RepliableInteraction | Message | Context,
    opts: BaseMessageOptions,
    interactionOpts?: { flags?: InteractionReplyOptions['flags'] },
  ): Promise<Message | InteractionResponse | null> {
    if (ctx instanceof Message || ctx instanceof Context) return await ctx.reply(opts);

    const replyMethod = getReplyMethod(ctx);
    const reply = await ctx[replyMethod]({
      ...opts,
      flags: interactionOpts?.flags,
      withResponse: true,
    });

    return 'resource' in reply
      ? ((reply as unknown as InteractionCallbackResponse).resource?.message ?? null)
      : reply;
  }

  private adjustIndex(customId: string, index: number) {
    if (customId === 'page_:back') return Math.max(0, index - 1);
    if (customId === 'page_:next') return index + 1;
    return index;
  }

  private formatMessage(
    actionButtons: ActionRowBuilder<ButtonBuilder>,
    replyOpts: BaseMessageOptions,
  ) {
    return { ...replyOpts, components: [actionButtons, ...(replyOpts.components || [])] };
  }

  private createButtons(index: number, totalPages: number) {
    const buttons = {
      select: new ButtonBuilder()
        .setEmoji(this.customEmojis.select)
        .setCustomId('page_:select')
        .setStyle(ButtonStyle.Secondary),
      back: new ButtonBuilder()
        .setEmoji(this.customEmojis.back)
        .setCustomId('page_:back')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      index: new ButtonBuilder()
        .setCustomId('page_:index')
        .setDisabled(true)
        .setLabel(`${index + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Primary),
      next: new ButtonBuilder()
        .setEmoji(this.customEmojis.next)
        .setCustomId('page_:next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= index + 1),
      search: new ButtonBuilder()
        .setEmoji(this.customEmojis.search)
        .setCustomId('page_:search')
        .setStyle(ButtonStyle.Secondary),
    };

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      Object.entries(buttons)
        .filter(
          ([key]) => key === 'index' || !this.hiddenButtons.includes(key as keyof ButtonEmojis),
        )
        .map(([, btn]) => btn),
    );
  }
}
