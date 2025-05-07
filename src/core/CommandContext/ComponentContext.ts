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
import Context, { ContextT } from '#src/core/CommandContext/Context.js';
import { CustomID } from '#src/utils/CustomID.js';
import { handleError } from '#src/utils/Utils.js';
import type {
  APIModalInteractionResponseCallbackData,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  JSONEncodable,
  MentionableSelectMenuInteraction,
  Message,
  MessageComponentInteraction,
  MessageEditOptions,
  ModalComponentData,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';

export type ComponentInteraction = MessageComponentInteraction | ModalSubmitInteraction;

/**
 * Context class for component interactions (buttons, select menus, modals)
 */
export default class ComponentContext extends Context<ContextT<ComponentInteraction>> {
  private readonly _customId: ReturnType<typeof CustomID.parseCustomId>;

  /**
   * Create a new ComponentContext
   * @param interaction The component interaction
   * @param command The command associated with this context (optional)
   */
  constructor(interaction: ComponentInteraction, command?: BaseCommand) {
    super(interaction, command || ({} as BaseCommand));
    this._customId = CustomID.parseCustomId(interaction.customId);
  }

  /**
   * Get the parsed custom ID for this interaction
   */
  public get customId() {
    return this._customId;
  }

  /**
   * Whether the interaction has been deferred
   */
  public get deferred() {
    return this.interaction.deferred;
  }

  /**
   * Whether the interaction has been replied to
   */
  public get replied() {
    return this.interaction.replied;
  }
  /**
   * Defer the reply to this interaction
   * @param opts Options for deferring
   */
  public async deferReply(opts?: { flags?: ['Ephemeral'] }): Promise<InteractionResponse> {
    return await this.interaction.deferReply({ ephemeral: opts?.flags?.includes('Ephemeral') });
  }

  /**
   * Defer the update to this interaction
   */
  public async deferUpdate(): Promise<InteractionResponse | null> {
    try {
      return await this.interaction.deferUpdate();
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
  public async reply(
    data: string | InteractionReplyOptions,
  ): Promise<Message | InteractionResponse> {
    try {
      if (this.interaction.replied || this.interaction.deferred) {
        return await this.interaction.followUp(data);
      }
      return await this.interaction.reply(data);
    }
    catch (error) {
      handleError(error);
      throw new Error('Failed to reply to interaction');
    }
  }

  /**
   * Delete the reply to this interaction
   */
  public async deleteReply() {
    try {
      await this.interaction.deleteReply();
    }
    catch (error) {
      handleError(error);
    }
  }

  /**
   * Edit the reply to this interaction
   * @param data The new data for the reply
   */
  public async editReply(data: string | MessageEditOptions | InteractionEditReplyOptions) {
    try {
      if (
        this.interaction.isMessageComponent() &&
        !this.interaction.deferred &&
        !this.interaction.replied
      ) {
        return await this.interaction.update(data);
      }

      return await this.interaction.editReply(data);
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Show a modal for this interaction
   * @param data The modal data
   */
  public async showModal(
    data:
      | JSONEncodable<APIModalInteractionResponseCallbackData>
      | ModalComponentData
      | APIModalInteractionResponseCallbackData,
  ) {
    try {
      if (this.isModalSubmit()) {
        throw new Error('Cannot show modal on a modal submit interaction');
      }
      else if (this.interaction.isMessageComponent()) {
        await this.interaction.showModal(data);
      }
    }
    catch (error) {
      handleError(error);
    }
  }

  /**
   * Get a value from a modal field
   * @param fieldId The ID of the field to get the value from
   * @returns The value of the field, or null if this isn't a modal interaction
   */
  public getModalFieldValue<C extends this['interaction']>(
    fieldId: string,
  ): C extends ModalSubmitInteraction ? string : null {
    return (
      this.isModalSubmit() ? this.interaction.fields.getTextInputValue(fieldId) : null
    ) as C extends ModalSubmitInteraction ? string : null;
  }

  /**
   * Get all values from modal fields
   * @returns An object with field IDs as keys and field values as values, or null if this isn't a modal interaction
   */
  public getModalFieldValues(): Record<string, string> | null {
    try {
      if (this.isModalSubmit()) {
        const result: Record<string, string> = {};
        for (const [id, value] of this.interaction.fields.fields) {
          result[id] = value.value;
        }
        return result;
      }
      return null;
    }
    catch (error) {
      handleError(error);
      return null;
    }
  }

  /**
   * Check if this interaction is a modal submit interaction
   * @returns Type predicate that narrows this.interaction to ModalSubmitInteraction
   */
  public isModalSubmit(): this is this & {
    interaction: ModalSubmitInteraction;
  } {
    return this.interaction.isModalSubmit();
  }

  /**
   * Check if this interaction is a button interaction
   * @returns Type predicate that narrows this.interaction to ButtonInteraction
   */
  public isButton(): this is this & {
    interaction: ButtonInteraction;
  } {
    return this.interaction.isButton();
  }

  /**
   * Check if this interaction is a string select menu interaction
   * @returns Type predicate that narrows this.interaction to StringSelectMenuInteraction
   */
  public isStringSelectMenu(): this is this & {
    interaction: StringSelectMenuInteraction;
  } {
    return this.interaction.isStringSelectMenu();
  }

  /**
   * Check if this interaction is a user select menu interaction
   * @returns Type predicate that narrows this.interaction to UserSelectMenuInteraction
   */
  public isUserSelectMenu(): this is this & {
    interaction: UserSelectMenuInteraction;
  } {
    return this.interaction.isUserSelectMenu();
  }

  /**
   * Check if this interaction is a role select menu interaction
   * @returns Type predicate that narrows this.interaction to RoleSelectMenuInteraction
   */
  public isRoleSelectMenu(): this is this & {
    interaction: RoleSelectMenuInteraction;
  } {
    return this.interaction.isRoleSelectMenu();
  }

  /**
   * Check if this interaction is a channel select menu interaction
   * @returns Type predicate that narrows this.interaction to ChannelSelectMenuInteraction
   */
  public isChannelSelectMenu(): this is this & {
    interaction: ChannelSelectMenuInteraction;
  } {
    return this.interaction.isChannelSelectMenu();
  }

  /**
   * Check if this interaction is a mentionable select menu interaction
   * @returns Type predicate that narrows this.interaction to MentionableSelectMenuInteraction
   */
  public isMentionableSelectMenu(): this is this & {
    interaction: MentionableSelectMenuInteraction;
  } {
    return this.interaction.isMentionableSelectMenu();
  }

  /**
   * Get the selected values from a string select menu
   * @returns An array of selected values, or null if this isn't a string select menu interaction
   */
  public get values() {
    return this.isStringSelectMenu() ? this.interaction.values : null;
  }

  /**
   * Get the selected users from a user select menu
   * @returns A collection of selected users, or null if this isn't a user select menu interaction
   */
  public get users() {
    return this.isUserSelectMenu() ? this.interaction.users : null;
  }

  /**
   * Get the selected roles from a role select menu
   * @returns A collection of selected roles, or null if this isn't a role select menu interaction
   */
  public get roles() {
    return this.isRoleSelectMenu() ? this.interaction.roles : null;
  }

  /**
   * Get the selected channels from a channel select menu
   * @returns A collection of selected channels, or null if this isn't a channel select menu interaction
   */
  public get channels() {
    return this.isChannelSelectMenu() ? this.interaction.channels : null;
  }

  /**
   * Get the selected members from a mentionable select menu
   * @returns A collection of selected members, or null if this isn't a mentionable select menu interaction
   */
  public get members() {
    return this.isMentionableSelectMenu() ? this.interaction.members : null;
  }
}
