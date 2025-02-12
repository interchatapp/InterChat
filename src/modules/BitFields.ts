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

import { BitField } from 'discord.js';

export const HubSettingsBits = {
  Reactions: 1 << 0,
  HideLinks: 1 << 1,
  SpamFilter: 1 << 2,
  BlockInvites: 1 << 3,
  UseNicknames: 1 << 4,
  BlockNSFW: 1 << 5,
} as const;

export type HubSettingsString = keyof typeof HubSettingsBits;
export type SerializedHubSettings = Record<HubSettingsString, boolean>;

export class HubSettingsBitField extends BitField<HubSettingsString> {
  public static readonly Flags = HubSettingsBits;

  /**
   * Toggles the specified hub settings.
   * If the settings are already present, they will be removed.
   * If the settings are not present, they will be added.
   * @param setting - The hub settings to toggle.
   * @returns The updated hub settings.
   */
  public toggle(...setting: HubSettingsString[]) {
    return this.has(setting) ? this.remove(setting) : this.add(setting);
  }
}
