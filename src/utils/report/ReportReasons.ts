import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import type { SelectMenuComponentOptionData } from 'discord.js';

export type ReportReason =
  | 'spam'
  | 'advertising'
  | 'nsfw'
  | 'harassment'
  | 'hate_speech'
  | 'scam'
  | 'illegal'
  | 'personal_info'
  | 'impersonation'
  | 'breaks_hub_rules'
  | 'trolling'
  | 'misinformation'
  | 'gore_violence'
  | 'raid_organizing'
  | 'underage';

export function getReasonFromKey(key: ReportReason, locale: supportedLocaleCodes): string {
  return t(`report.reasons.${key}`, locale);
}

export function getReportReasons(locale: supportedLocaleCodes): SelectMenuComponentOptionData[] {
  return [
    { value: 'spam', label: t('report.reasons.spam', locale) },
    { value: 'advertising', label: t('report.reasons.advertising', locale) },
    { value: 'nsfw', label: t('report.reasons.nsfw', locale) },
    { value: 'harassment', label: t('report.reasons.harassment', locale) },
    { value: 'hate_speech', label: t('report.reasons.hate_speech', locale) },
    { value: 'scam', label: t('report.reasons.scam', locale) },
    { value: 'illegal', label: t('report.reasons.illegal', locale) },
    { value: 'personal_info', label: t('report.reasons.personal_info', locale) },
    { value: 'impersonation', label: t('report.reasons.impersonation', locale) },
    { value: 'breaks_hub_rules', label: t('report.reasons.breaks_hub_rules', locale) },
    { value: 'trolling', label: t('report.reasons.trolling', locale) },
    { value: 'misinformation', label: t('report.reasons.misinformation', locale) },
    { value: 'gore_violence', label: t('report.reasons.gore_violence', locale) },
    { value: 'raid_organizing', label: t('report.reasons.raid_organizing', locale) },
    { value: 'underage', label: t('report.reasons.underage', locale) },
  ];
}
