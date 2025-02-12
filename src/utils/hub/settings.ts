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

import { ActionRowBuilder, type Client, type Snowflake, StringSelectMenuBuilder } from 'discord.js';
import type { SerializedHubSettings } from '#src/modules/BitFields.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { CustomID } from '#utils/CustomID.js';

export const buildSettingsMenu = (
  rawSettings: SerializedHubSettings,
  hubId: string,
  userId: Snowflake,
  client: Client,
) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('hubEdit', 'settingsSelect')
          .setArgs(userId)
          .setArgs(hubId)
          .toString(),
      )
      .setPlaceholder('Select an option')
      .addOptions(
        Object.entries(rawSettings).map(([setting, isEnabled]) => {
          const emoji = isEnabled ? getEmoji('x_icon', client) : getEmoji('tick_icon', client);
          return {
            label: `${isEnabled ? 'Disable' : 'Enable'} ${setting}`,
            value: setting,
            emoji,
          };
        }),
      ),
  );
