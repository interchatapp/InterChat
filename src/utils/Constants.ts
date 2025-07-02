import { createRequire } from 'node:module';
import type { Colors, HexColorString, Snowflake } from 'discord.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

export const enum RedisKeys {
  msgTimestamp = 'msgTimestamp',
  lastActive = 'lastActive',
  userData = 'UserData',
  cooldown = 'cooldown',
  blacklistedServers = 'blacklistedServers',
  channelQueue = 'channelQueue',
  commandUsesLeft = 'commandUsesLeft',
  msgDeleteInProgress = 'msgDeleteInProgress',
  msgEditInProgress = 'msgEditInProgress',
  Infraction = 'Infraction',
  hubLogConfig = 'hubLogConfig',
  message = 'message',
  broadcasts = 'broadcasts',
  messageReverse = 'messageReverse',
  Hub = 'hub',
  Spam = 'spam',
  DevAnnouncement = 'DevAnnouncement',
  RulesShown = 'rulesShown',
  Call = 'call', // Base prefix for all call-related keys
  CallRecentMatches = 'call:recent_matches',
  CallTypingRateLimit = 'call:typing_rate_limit', // Rate limiting for typing indicators
  CallQueue = 'call:queue', // Call queue (will be migrated to DB)
  CallActive = 'call:active', // Active calls (will be migrated to DB)
  Achievement = 'achievement', // Base prefix for all achievement-related keys
  LastHubMessageUser = 'lastHubMessageUser',
  ReportReporter = 'report:reporter', // Stores reporter ID for report resolution notifications
  tutorialData = 'tutorialData', // Base prefix for all tutorial-related keys
  tutorialProgress = 'tutorialProgress', // Stores user progress in tutorials
  AntiSwear = 'antiswear', // Base prefix for all anti-swear related keys
  HubRules = 'rules', // Base prefix for all hub rules related keys
  ContentFilter = 'contentFilter',
}

export const enum ConnectionMode {
  Compact = 0,
  Embed = 1,
}

/** Unicode emojis for numbers */
export const numberEmojis = [
  '0️⃣',
  '1️⃣',
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
  '🔟',
] as const;

export default {
  isDevBuild: process.env.NODE_ENV === 'development',

  DeveloperIds: ['701727675311587358'] as Snowflake[],
  StaffIds: [
    '1160735837940617336',
    '982656475979710524',
    '853178500193583104',
    '994411851557392434',
    '1189255119175430237',
    '873016163708334085',
  ] as Snowflake[],
  SupporterIds: ['880978672037802014', '786348225341947986'] as Snowflake[],
  TranslatorIds: [
    '845357241132384286',
    '1289961731115847803',
    '827745783964499978',
    '456361646273593345',
    '842283470301822986',
    '1289961731115847803',
    '650634957647249408',
    '1065564110844071996',
  ] as Snowflake[],
  ProjectVersion: packageJson.version ?? 'Unknown',
  SupportServerId: '770256165300338709',
  VoterRoleId: '985153241727770655',
  DonorRoleId: '1234567890123456789', // TODO: Replace with actual donor role ID

  // Regexp
  Regex: {
    ImageURL: /\bhttps?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S+)?\b/,
    MediaURL: /\bhttps?:\/\/\S+?\.(?:|mp4|mov|webm|webp)(?:\?\S+)?\b/,
    /** no animated images */
    StaticImageUrl: /\bhttps?:\/\/\S+?\.(?:png|jpe?g|webp)(?:\?\S+)?\b/,
    /** ignores giphy and tenor */
    Links: /https?:\/\/(?!tenor\.com|giphy\.com)\S+/g,
    TenorLinks: /https:\/\/tenor\.com\/view\/.*-(\d+)/,
    Emoji: /<(a)?:([a-zA-Z0-9_]+):(\d+)>/,
    BannedWebhookWords: /discord|clyde|```/gi,
    SpecialCharacters: /[^a-zA-Z0-9|$|@]|\^/g,
    MatchWord: /\w/g,
    SplitWords: /\b/,
    Hexcode: /^#[0-9A-F]{6}$/i,
    ChannelMention: /<#|!|>/g,
    ImgurImage: /https?:\/\/i\.imgur\.com\/[a-zA-Z0-9]+\.((jpg)|(jpeg)|(png)|(gif))/g,
    MessageId: /(?:https?:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+\/)?(\d{17,20})/,
    SimpleRegexEscape: /[.*+?^${}()|[\]\\]/g,
    RegexChars: /[-[\]{}()*+?.,\\^$|#\s]/g,
    DiscordEmojiUrl: /^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.[a-z]+$/i,
    ChannelId: /(?<=\/channels\/\d{17,20}\/|<#?)\d{17,20}(?=>?)(?!\d)/,
    UserId: /(?:<@!? ?(\d+)>|\b(\d{17,20})\b(?!\/))/,
    RoleId: /(?:<@& ?(\d+)>|\b(\d{17,20})\b(?!\/))/,
    DiscordInvite:
      /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)([a-zA-Z0-9-]{6,32})/g,
  },

  Links: {
    Website: 'https://interchat.tech',
    TopggApi: 'https://top.gg/api/bots/769921109209907241',
    Vote: 'https://top.gg/bot/769921109209907241/vote',
    Donate: 'https://ko-fi.com/interchat',
    SupportInvite: 'https://discord.gg/8DhUA4HNpD',
    AppDirectory: 'https://discord.com/application-directory/769921109209907241',
    EasterAvatar: 'https://i.imgur.com/80nqtSg.png',
  },

  Channels: {
    goal: '906460473065615403',
    inviteLogs: '1246117516099457146',
    reports: '1347765409314766849',
  },

  Colors: {
    all: [
      'Default',
      'White',
      'Aqua',
      'Green',
      'Blue',
      'Yellow',
      'Purple',
      'LuminousVividPink',
      'Fuchsia',
      'Gold',
      'Orange',
      'Red',
      'Grey',
      'DarkNavy',
      'DarkAqua',
      'DarkGreen',
      'DarkBlue',
      'DarkPurple',
      'DarkVividPink',
      'DarkGold',
      'DarkOrange',
      'DarkRed',
      'DarkGrey',
      'DarkerGrey',
      'LightGrey',
      'DarkNavy',
      'Blurple',
      'Greyple',
      'DarkButNotBlack',
      'NotQuiteBlack',
      'Random',
    ] as (keyof typeof Colors)[],
    // InterChat v5 Design System Colors
    primary: '#9172D8' as HexColorString, // Primary brand color
    secondary: '#57F287' as HexColorString, // Secondary brand color
    tertiary: '#EB459E' as HexColorString, // Accent color

    // Semantic colors
    success: '#57F287' as HexColorString, // Success messages and actions
    warning: '#FEE75C' as HexColorString, // Warning messages and caution states
    error: '#ED4245' as HexColorString, // Error messages and destructive actions
    info: '#5865F2' as HexColorString, // Informational messages

    // UI colors
    background: '#2F3136' as HexColorString, // color for containers
    foreground: '#FFFFFF' as HexColorString, // Text color (to match website)
    muted: '#B9BBBE' as HexColorString, // Subdued text color (to match website)
    invisible: '#2b2d31' as HexColorString, // Invisible embed color

    // Seasonal colors
    christmas: ['#00B32C', '#D6001C', '#FFFFFF'] as HexColorString[],
  },
} as const;
