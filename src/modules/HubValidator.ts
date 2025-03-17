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

import type { Client } from 'discord.js';
import type HubManager from '#src/managers/HubManager.js';
import { type HubCreationData, HubService } from '#src/services/HubService.js';
import Constants from '#src/utils/Constants.js';
import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';
import { type supportedLocaleCodes, t } from '#src/utils/Locale.js';
import UserDbService from '#src/services/UserDbService.js';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export class HubValidator {
  private readonly locale: supportedLocaleCodes;
  private readonly hubService = new HubService();
  private readonly client: Client;

  constructor(locale: supportedLocaleCodes, client: Client) {
    this.locale = locale;
    this.client = client;
  }

  private static readonly MAX_HUBS_PER_USER = 1;

  private getEmoji(name: EmojiKeys): string {
    return getEmoji(name, this.client);
  }

  async validateNewHub(
    data: HubCreationData,
    existingHubs: HubManager[],
  ): Promise<ValidationResult> {
    const nameValidation = this.validateHubName(data.name);
    if (!nameValidation.isValid) return nameValidation;

    const uniqueNameValidation = await this.validateUniqueName(data.name);
    if (!uniqueNameValidation.isValid) return uniqueNameValidation;

    const hubLimitValidation = await this.validateHubLimit(data.ownerId, existingHubs);
    if (!hubLimitValidation.isValid) return hubLimitValidation;

    const imageValidation = this.validateImages(data.iconUrl, data.bannerUrl);
    if (!imageValidation.isValid) return imageValidation;

    return { isValid: true };
  }

  private validateHubName(name: string): ValidationResult {
    if (Constants.Regex.BannedWebhookWords.test(name)) {
      return {
        isValid: false,
        error: t('hub.create.invalidName', this.locale, {
          emoji: this.getEmoji('x_icon'),
        }),
      };
    }
    return { isValid: true };
  }

  private async validateUniqueName(name: string): Promise<ValidationResult> {
    const existingHub = await this.hubService.fetchHub({ name });
    if (existingHub) {
      return {
        isValid: false,
        error: t('hub.create.nameTaken', this.locale, {
          emoji: this.getEmoji('x_icon'),
        }),
      };
    }
    return { isValid: true };
  }

  private async validateHubLimit(
    ownerId: string,
    existingHubs: HubManager[],
  ): Promise<ValidationResult> {
    const userHubCount = existingHubs.reduce(
      (acc, hub) => (hub.isOwner(ownerId) ? acc + 1 : acc),
      0,
    );

    const isVoter = await new UserDbService().userVotedToday(ownerId);
    const maxHubs = isVoter ? 4 : HubValidator.MAX_HUBS_PER_USER;

    if (userHubCount >= maxHubs) {
      return {
        isValid: false,
        error: t('hub.create.maxHubs', this.locale, {
          emoji: this.getEmoji('x_icon'),
          maxHubs: String(maxHubs),
          voteUrl: Constants.Links.Vote,
        }),
      };
    }
    return { isValid: true };
  }

  private validateImages(iconUrl?: string, bannerUrl?: string): ValidationResult {
    const imgurRegex = Constants.Regex.ImgurImage;

    if ((iconUrl && !imgurRegex.test(iconUrl)) || (bannerUrl && !imgurRegex.test(bannerUrl))) {
      return {
        isValid: false,
        error: t('hub.invalidImgurUrl', this.locale, {
          emoji: this.getEmoji('x_icon'),
        }),
      };
    }
    return { isValid: true };
  }
}
