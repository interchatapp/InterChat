import { createRequire } from 'node:module';
import type { Colors, HexColorString, Snowflake } from 'discord.js';

const require = createRequire(import.meta.url);
const badwords = require('./JSON/profanity.json');
const packageJson = require('../../package.json');

export const { slurs, profanity } = badwords as {
  slurs: string[];
  profanity: string[];
};

export const enum RedisKeys {
  msgTimestamp = 'msgTimestamp',
  lastActive = 'lastActive',
  connectionHubId = 'connectionHubId',
  userData = 'UserData',
  cooldown = 'cooldown',
  blacklistedServers = 'blacklistedServers',
  channelQueue = 'channelQueue',
  commandUsesLeft = 'commandUsesLeft',
  msgDeleteInProgress = 'msgDeleteInProgress',
  Infraction = 'Infraction',
  hubLogConfig = 'hubLogConfig',
  message = 'message',
  broadcasts = 'broadcasts',
  messageReverse = 'messageReverse',
  Hub = 'hub',
}

export const enum ConnectionMode {
  Compact = 0,
  Embed = 1,
}

/** Unicode emojis for numbers */
export const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const;

export default {
  isDevBuild: process.env.NODE_ENV === 'development',

  StaffIds: ['1160735837940617336', '982656475979710524', '597265261665714186'] as Snowflake[],
  DeveloperIds: ['701727675311587358'] as Snowflake[],
  SupporterIds: ['880978672037802014', '786348225341947986'] as Snowflake[],

  ProjectVersion: packageJson.version ?? 'Unknown',
  SupportServerId: '770256165300338709',
  VoterRoleId: '985153241727770655',

  // Regexp
  Regex: {
    ImageURL: /\bhttps?:\/\/\S+?\.(?:png|jpe?g|gif)(?:\?\S+)?\b/,
    /** no animated images */
    StaticImageUrl: /\bhttps?:\/\/\S+?\.(?:png|jpe?g|webp)(?:\?\S+)?\b/,
    /** ignores giphy and tenor */
    Links: /https?:\/\/(?!tenor\.com|giphy\.com)\S+/g,
    /** matches profanity words */
    Profanity: new RegExp(profanity.map((word) => `\\b${word}\\b`).join('|'), 'gi'),
    /** matches slurs */
    Slurs: new RegExp(slurs.map((word) => `\\b${word}\\b`).join('|'), 'gi'),
    TenorLinks: /https:\/\/tenor\.com\/view\/.*-(\d+)/,
    Emoji: /<(a)?:([a-zA-Z0-9_]+):(\d+)>/,
    BannedWebhookWords: /discord|clyde|```/gi,
    SpecialCharacters: /[^a-zA-Z0-9|$|@]|\^/g,
    MatchWord: /\w/g,
    SplitWords: /\b/,
    Hexcode: /^#[0-9A-F]{6}$/i,
    ChannelMention: /<#|!|>/g,
    ImgurImage: /https?:\/\/i\.imgur\.com\/[a-zA-Z0-9]+\.((jpg)|(jpeg)|(png)|(gif))/g,
    MessageLink: /https:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/,
    SimpleRegexEscape: /[.*+?^${}()|[\]\\]/g,
    RegexChars: /[-[\]{}()*+?.,\\^$|#\s]/g,
    DiscordEmojiUrl: /^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.[a-z]+$/i,
    ChannelId: /(?<=\/channels\/\d{17,20}\/|<#?)\d{17,20}(?=>?)(?!\d)/,
    UserId: /(?:<@!? ?(\d+)>|\b(\d{17,20})\b(?!\/))/,
    RoleId: /(?:<@& ?(\d+)>|\b(\d{17,20})\b(?!\/))/,
  },

  Links: {
    Website: 'https://interchat.tech',
    TopggApi: 'https://top.gg/api/bots/769921109209907241',
    Vote: 'https://top.gg/bot/769921109209907241/vote',
    Donate: 'https://ko-fi.com/dev737',
    SupportInvite: 'https://discord.gg/8DhUA4HNpD',
    AppDirectory: 'https://discord.com/application-directory/769921109209907241',
    RulesBanner: 'https://i.imgur.com/MBG0Rks.png',
    EasterAvatar: 'https://i.imgur.com/80nqtSg.png',
  },

  Channels: {
    devChat: '770488420521738250',
    networklogs: '1156144879869632553',
    modlogs: '1042265633896796231',
    reports: '1158773603551162398',
    goal: '906460473065615403',
    suggestions: '1021256657528954900',
    inviteLogs: '1246117516099457146',
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
    interchatBlue: '#9172D8' as HexColorString,
    invisible: '#2b2d31' as HexColorString,
    christmas: ['#00B32C', '#D6001C', '#FFFFFF'] as HexColorString[],
  },
} as const;
