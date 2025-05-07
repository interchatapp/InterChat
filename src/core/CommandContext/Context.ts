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

import type BaseCommand from '#src/core/BaseCommand.js';
import ContextOptions from '#src/core/CommandContext/ContextOpts.js';
import type { TranslationKeys } from '#src/types/TranslationKeys.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { fetchUserLocale, extractMessageId, handleError } from '#src/utils/Utils.js';
import {
  type APIActionRowComponent,
  type APIInteractionGuildMember,
  type APIComponentInMessageActionRow,
  type APIModalInteractionResponseCallbackData,
  type ActionRowData,
  type BitFieldResolvable,
  type ChatInputCommandInteraction,
  type Client,
  type ContextMenuCommandInteraction,
  type Guild,
  type GuildMember,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionResponse,
  type JSONEncodable,
  Message,
  type MessageActionRowComponentBuilder,
  type MessageActionRowComponentData,
  MessageContextMenuCommandInteraction,
  type MessageComponentInteraction,
  type MessageEditOptions,
  type MessageFlags,
  type MessageFlagsString,
  type MessagePayload,
  type MessageReplyOptions,
  type ModalComponentData,
  type ModalSubmitInteraction,
  UserContextMenuCommandInteraction,
  CacheType,
} from 'discord.js';

/**
 * Base interface for all context interactions
 */
export interface BaseContextInteraction {
  channel: Message['channel'] | null;
  channelId: string | null;
  guild: Guild | null;
  guildId: string | null;
  client: Client;
  member: GuildMember | APIInteractionGuildMember | null;
}

/**
 * Valid interaction types that can be used with Context
 */
export type ValidContextInteractions<C extends CacheType = CacheType> =
  | Message<C extends 'cached' ? true : false>
  | ChatInputCommandInteraction<C>
  | ContextMenuCommandInteraction<C>
  | MessageComponentInteraction<C>
  | ModalSubmitInteraction<C>;

/**
 * Base context type definition
 */
export interface ContextT<T = ValidContextInteractions, R = Message | InteractionResponse> {
  interaction: T;
  responseType: R;
}

/**
 * Abstract base class for all context types
 */
export default abstract class Context<T extends ContextT = ContextT> {
  public readonly interaction: T['interaction'];
  protected readonly command: BaseCommand;
  protected readonly _options: ContextOptions;

  /**
   * Whether the interaction has been deferred
   */
  abstract get deferred(): boolean;

  /**
   * Whether the interaction has been replied to
   */
  abstract get replied(): boolean;

  /**
   * Create a new Context instance
   * @param interaction The Discord.js interaction object
   * @param command The command associated with this context
   */
  constructor(interaction: T['interaction'], command: BaseCommand) {
    this.interaction = interaction;
    this.command = command;
    this._options = new ContextOptions(this);
  }

  /**
   * Get the options for this context
   */
  public get options() {
    return this._options;
  }

  /**
   * Get the channel for this interaction
   */
  public get channel() {
    return this.interaction.channel;
  }

  /**
   * Get the channel ID for this interaction
   */
  public get channelId() {
    return this.interaction.channelId;
  }

  /**
   * Get the guild for this interaction
   * Returns Guild if in a cached guild, otherwise Guild | null
   *
   * Use inGuild() type guard before accessing this property to ensure non-null access
   */
  public get guild() {
    return this.interaction.guild;
  }

  /**
   * Get the guild ID for this interaction
   * Returns string if in a cached guild, otherwise string | null
   *
   * Use inGuild() type guard before accessing this property to ensure non-null access
   */
  public get guildId() {
    return this.interaction.guildId;
  }
  /**
   * Get the user for this interaction
   */
  public get user() {
    return this.interaction instanceof Message ? this.interaction.author : this.interaction.user;
  }

  /**
   * Get the member for this interaction
   * Returns GuildMember if in a cached guild, otherwise null
   */
  public get member() {
    return this.interaction.member;
  }

  /**
   * Get the client for this interaction
   */
  public get client() {
    return this.interaction.client;
  }

  /**
   * Type guard to check if this interaction is in a guild
   * When this returns true, guild, guildId, and member properties are guaranteed to be non-null
   * @returns Type predicate that narrows guild, guildId, and member to non-null values
   */
  public inGuild(): this is Context<T> & {
    guild: Guild;
    guildId: string;
    member: GuildMember;
    channelId: string;
  } {
    if (this.interaction instanceof Message) return this.interaction.inGuild();
    return this.interaction.inCachedGuild();
  }

  /**
   * Get an emoji by name
   * @param name The emoji name
   * @returns The emoji string or empty string if client is not ready
   */
  public getEmoji(name: EmojiKeys): string {
    if (!this.client?.isReady()) return '';
    return getEmoji(name, this.client);
  }

  /**
   * Get the locale for the current user
   * @returns The user's locale
   */
  public async getLocale(): Promise<supportedLocaleCodes> {
    return await fetchUserLocale(this.user.id);
  }

  /**
   * Defer the reply to this interaction
   * @param opts Options for deferring
   */
  abstract deferReply(opts?: { flags?: ['Ephemeral'] }): Promise<T['responseType'] | null>;

  /**
   * Get the target message ID for this interaction
   * @param name The option name containing the message ID or link
   */
  public getTargetMessageId(name: string | null): string | null {
    try {
      if (this.interaction instanceof MessageContextMenuCommandInteraction) {
        return this.interaction.targetId;
      }

      if (this.interaction instanceof Message && this.interaction.reference) {
        return this.interaction.reference.messageId ?? null;
      }

      if (!name) return null;

      const value = this.options.getString(name);
      if (!value) return null;

      return extractMessageId(value) ?? null;
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Get the target user for this interaction
   * @param name The option name containing the user mention or ID
   */
  public async getTargetUser(name?: string) {
    try {
      if (this.interaction instanceof UserContextMenuCommandInteraction) {
        return this.interaction.targetId;
      }

      if (!name) return null;

      return await this.options.getUser(name);
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Get the target message for this interaction
   * @param name The option name containing the message ID or link
   */
  public async getTargetMessage(name: string | null): Promise<Message | null> {
    try {
      if (this.interaction instanceof MessageContextMenuCommandInteraction) {
        return this.interaction.targetMessage;
      }

      const targetMessageId = this.getTargetMessageId(name);
      if (!targetMessageId || !this.interaction.channel) return null;

      return await this.interaction.channel.messages.fetch(targetMessageId).catch(() => null);
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Reply with an embed
   * @param desc The description or translation key
   * @param opts Additional options for the embed
   */
  async replyEmbed<K extends keyof TranslationKeys>(
    desc: K | (string & NonNullable<unknown>),
    opts?: {
      t?: { [Key in TranslationKeys[K]]: string };
      content?: string;
      title?: string;
      components?: readonly (
        | JSONEncodable<APIActionRowComponent<APIComponentInMessageActionRow>>
        | ActionRowData<MessageActionRowComponentData | MessageActionRowComponentBuilder>
        | APIActionRowComponent<APIComponentInMessageActionRow>
      )[];
      flags?: BitFieldResolvable<
        Extract<
          MessageFlagsString,
          'Ephemeral' | 'SuppressEmbeds' | 'SuppressNotifications' | 'IsComponentsV2'
        >,
        | MessageFlags.Ephemeral
        | MessageFlags.SuppressEmbeds
        | MessageFlags.SuppressNotifications
        | MessageFlags.IsComponentsV2
      >;
      edit?: boolean;
    },
  ): Promise<T['responseType'] | null> {
    try {
      const locale = await this.getLocale();
      const description = t(desc as K, locale, opts?.t) || desc;

      const embed = new InfoEmbed().setDescription(description).setTitle(opts?.title);
      const message = { content: opts?.content, embeds: [embed], components: opts?.components };

      if (opts?.edit) {
        return await this.editOrReply({ ...message, content: message.content });
      }
      return await this.reply({ ...message, flags: opts?.flags });
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Edit the reply to this interaction
   * @param data The new data for the reply
   */
  abstract editReply(
    data: string | MessageEditOptions | InteractionEditReplyOptions,
  ): Promise<T['responseType'] | null>;

  /**
   * Edit the reply if already replied, otherwise send a new reply
   * @param data The data for the reply
   * @param flags Message flags to apply
   */
  async editOrReply(
    data: string | Omit<MessageEditOptions, 'flags'> | Omit<InteractionEditReplyOptions, 'flags'>,
    flags: Extract<
      MessageFlagsString,
      'Ephemeral' | 'SuppressEmbeds' | 'SuppressNotifications' | 'IsComponentsV2'
    >[] = [],
  ): Promise<T['responseType'] | null> {
    try {
      const data_ = typeof data === 'string' ? { content: data } : { ...data };

      if (this.deferred || this.replied) {
        const supportedFlags = ['SuppressEmbeds', 'IsComponentsV2'] as const;

        return await this.editReply({
          ...data_,
          flags: supportedFlags.filter((flag) => flags.includes(flag)),
        });
      }

      return await this.reply({
        ...data_,
        flags,
        content: data_.content ?? undefined,
      } satisfies InteractionReplyOptions);
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Reply to this interaction
   * @param data The data for the reply
   */
  abstract reply(
    data:
      | string
      | MessagePayload
      | MessageReplyOptions
      | InteractionReplyOptions
      | MessageEditOptions,
  ): Promise<T['responseType']>;

  /**
   * Delete the reply to this interaction
   */
  abstract deleteReply(): Promise<void>;

  /**
   * Show a modal for this interaction
   * @param data The modal data
   */
  abstract showModal(
    data:
      | JSONEncodable<APIModalInteractionResponseCallbackData>
      | ModalComponentData
      | APIModalInteractionResponseCallbackData,
  ): Promise<void>;
}
