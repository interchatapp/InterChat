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

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import type { TranslationKeys } from '#types/TranslationKeys.d.ts';
import Logger from '#utils/Logger.js';

const localesMap = new Map();

export const supportedLocales = {
  bg: { name: 'Bulgarian', emoji: '🇧🇬' },
  cs: { name: 'Czech', emoji: '🇨🇿' },
  da: { name: 'Danish', emoji: '🇩🇰' },
  de: { name: 'German', emoji: '🇩🇪' },
  el: { name: 'Greek', emoji: '🇬🇷' },
  en: { name: 'English', emoji: '🇺🇸' },
  es: { name: 'Spanish', emoji: '🇪🇸' },
  fi: { name: 'Finnish', emoji: '🇫🇮' },
  fr: { name: 'French', emoji: '🇫🇷' },
  et: { name: 'Estonian', emoji: '🇪🇪' },
  // hr: { name: 'Croatian', emoji: '🇭🇷' },
  hu: { name: 'Hungarian', emoji: '🇭🇺' },
  id: { name: 'Indonesian', emoji: '🇮🇩' },
  it: { name: 'Italian', emoji: '🇮🇹' },
  ja: { name: 'Japanese', emoji: '🇯🇵' },
  ko: { name: 'Korean', emoji: '🇰🇷' },
  nl: { name: 'Dutch', emoji: '🇳🇱' },
  no: { name: 'Norwegian', emoji: '🇳🇴' },
  pl: { name: 'Polish', emoji: '🇵🇱' },
  pt: { name: 'Portuguese', emoji: '🇵🇹' },
  ru: { name: 'Russian', emoji: '🇷🇺' },
  sv: { name: 'Swedish', emoji: '🇸🇪' },
  th: { name: 'Thai', emoji: '🇹🇭' },
  tr: { name: 'Turkish', emoji: '🇹🇷' },
  uk: { name: 'Ukrainian', emoji: '🇺🇦' },
  vi: { name: 'Vietnamese', emoji: '🇻🇳' },
  hi: { name: 'Hindi', emoji: '🇮🇳' },
  zh: { name: 'Chinese', emoji: '🇨🇳' },
} as const;

export type supportedLocaleCodes = keyof typeof supportedLocales;

export const loadLocales = (localesDirectory: string) => {
  const files = fs.readdirSync(localesDirectory);

  files.forEach((file: string) => {
    const filePath = path.join(localesDirectory, file);
    const localeKey = path.basename(file, '.yml');

    const content = fs.readFileSync(filePath, 'utf8');
    const parsedContent = load(content);

    localesMap.set(localeKey, parsedContent);
  });

  Logger.info(`${localesMap.size} Locales loaded successfully.`);
};

const getTranslationFile = (locale: supportedLocaleCodes, throwOnFail = false) => {
  const localeFile = localesMap.get(locale) || localesMap.get('en');
  if (!localeFile) {
    if (throwOnFail) throw new Error(`Locale file for ${locale} not found! Fallback to en failed.`);

    // Reload locales & try again
    loadLocales('locales');
    return getTranslationFile(locale, true);
  }

  return localeFile;
};

const getTranslation = (
  phrase: keyof TranslationKeys,
  locale: supportedLocaleCodes,
): string | undefined => {
  const localeFile = getTranslationFile(locale);
  const translation: string | undefined = phrase
    .split('.')
    .reduce((obj, segment) => obj?.[segment], localeFile);

  if (!translation && locale !== 'en') {
    return getTranslation(phrase, 'en');
  }

  return translation;
};

/** Get the translated text with variable replacement */
// skipcq: JS-C1002
export const t = <K extends keyof TranslationKeys>(
  phrase: K,
  locale: supportedLocaleCodes,
  variables?: { [Key in TranslationKeys[K]]: string },
): string => {
  const translation = getTranslation(phrase, locale);

  if (translation) {
    // Replace variables in the translated text
    let result = translation;

    if (variables) {
      for (const variable of Object.keys(variables)) {
        result = result.replace(
          new RegExp(`{${variable}}`, 'g'),
          variables[variable as TranslationKeys[K]],
        );
      }
    }

    return result;
  }

  Logger.warn(`Translation for key '${phrase}' not found in ${locale} language.`);
  return phrase;
};
