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
import type {
  APIModalInteractionResponseCallbackData,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  JSONEncodable,
  Message,
  ModalComponentData,
} from 'discord.js';

export default class InteractionContext extends Context<{
  interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction;
  responseType: Message | InteractionResponse;
}> {

  public get deferred() {
    return this.interaction.deferred;
  }

  public get replied() {
    return this.interaction.replied;
  }

  public async deferReply(opts?: { flags?: ['Ephemeral'] }) {
    return await this.interaction.deferReply({ flags: opts?.flags });
  }

  public async reply(data: string | InteractionReplyOptions) {
    if (this.interaction.replied || this.interaction.deferred) {
      return await this.interaction.followUp(data);
    }

    return await this.interaction.reply(data);
  }

  public async deleteReply() {
    await this.interaction.deleteReply();
  }

  public async editReply(
    data: string | InteractionEditReplyOptions,
  ): Promise<Message<boolean> | InteractionResponse<boolean>> {
    return await this.interaction.editReply(data);
  }

  public async showModal(
    data:
			| JSONEncodable<APIModalInteractionResponseCallbackData>
			| ModalComponentData
			| APIModalInteractionResponseCallbackData,
  ) {
    await this.interaction.showModal(data);
  }
}
