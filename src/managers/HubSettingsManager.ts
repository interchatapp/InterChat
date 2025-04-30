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

import type HubManager from '#src/managers/HubManager.js';
import {
  HubSettingsBitField,
  HubSettingsBits,
  type HubSettingsString,
} from '#src/modules/BitFields.js';
import { HubService } from '#src/services/HubService.js';

import type { BitFieldResolvable } from 'discord.js';

export default class HubSettingsManager {
  private readonly hub: HubManager;
  private settings: HubSettingsBitField;

  constructor(hub: HubManager) {
    this.hub = hub;
    this.settings = new HubSettingsBitField(hub.data.settings ?? 0);
  }

  static async create(hubId: string): Promise<HubSettingsManager> {
    const hub = await new HubService().fetchHub(hubId);
    if (!hub) throw new Error('Hub not found');
    return new HubSettingsManager(hub);
  }

  async updateSetting(setting: HubSettingsString, value?: boolean): Promise<boolean> {
    if (value === undefined) {
      // Toggle the setting if no value is provided
      this.settings.toggle(setting);
    }
    else if (value) {
      // Enable the setting
      this.settings.add(setting);
    }
    else {
      // Disable the setting
      this.settings.remove(setting);
    }

    await this.saveSettings();
    return this.has(setting);
  }

  async updateMultipleSettings(
    updates: BitFieldResolvable<HubSettingsString, number>,
  ): Promise<void> {
    if (typeof updates === 'number') {
      this.settings = new HubSettingsBitField(updates);
      await this.saveSettings();
      return;
    }
    for (const [setting, value] of Object.entries(updates)) {
      if (value) this.settings.add(setting as HubSettingsString);
      else this.settings.remove(setting as HubSettingsString);
    }

    await this.saveSettings();
  }

  has(setting: HubSettingsString): boolean {
    return this.settings.has(setting);
  }

  getAll(): Record<HubSettingsString, boolean> {
    return this.settings.serialize(this.settings.freeze());
  }

  private async saveSettings(): Promise<void> {
    await this.hub.update({ settings: this.settings.bitfield });
  }

  // Helper method to reset all settings to default
  async resetToDefault(): Promise<void> {
    this.settings = new HubSettingsBitField(0);
    await this.saveSettings();
  }

  // Helper method to enable all settings
  async enableAll(): Promise<void> {
    this.settings.add(Object.keys(HubSettingsBits) as HubSettingsString[]);

    await this.saveSettings();
  }

  // Helper method to disable all settings
  async disableAll(): Promise<void> {
    this.settings = new HubSettingsBitField(0);
    await this.saveSettings();
  }
}
