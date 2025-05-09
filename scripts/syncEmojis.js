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

// @ts-check

import { stripIndent } from 'common-tags';
import { Collection, REST, Routes } from 'discord.js';
import requiredEmojis from '../src/utils/JSON/emojis.json' with { type: 'json' };
import {
  Spinner,
  getTimestampFromSnowflake,
  greenText,
  greyText,
  orangeText,
  redText,
} from './utils.js';

if (!process.isBun) {
  throw new Error(`${redText('This script must be run using')} ${orangeText('bun run')}.`);
}

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  throw new Error('Missing Discord token or client ID.');
}

const jsonFile = Bun.file('src/utils/JSON/emojis.json');

const rest = new REST({ version: '10' }).setToken(TOKEN);
const route = Routes.applicationEmojis(CLIENT_ID);
/**
 * @type {Collection<string, import('discord.js').APIEmoji>}
 */
const APIEmojiCollection = new Collection();

async function initialize() {
  const spinner = new Spinner();
  spinner.start('Syncing emojis with Discord...');

  // Fetch all existing emojis
  await fetchEmojis();

  const requiredEmojisArray = Object.entries(requiredEmojis);
  let missingEmojis = 0;
  let erroredEmojis = 0;
  const emojisToSyncWithJson = [];

  for (let i = 0; i < requiredEmojisArray.length; i++) {
    const [name, data] = requiredEmojisArray[i];
    const indexStr = greyText(`[${i}/${requiredEmojisArray.length}]`);

    let emoji = APIEmojiCollection.get(name);
    const updatedAt = new Date(data.updatedAt || Date.now());

    if (emoji && getTimestampFromSnowflake(emoji.id) < updatedAt) {
      spinner.edit(
        `${indexStr} ${orangeText(`⚠️ Deleting and re-creating emoji ${emoji.name} - ${getEmojiUrl(emoji)} since it already exists.`)}`,
      );
      await deleteEmoji(emoji.id);
      emoji = undefined;
    }

    if (!emoji) {
      try {
        spinner.edit(`${indexStr} Creating emoji ${name}...`);

        const createdEmoji = await createEmoji({
          name,
          image: await fetchEmojiImage(data.url),
        });

        // if updatedAt is not set, it means the emoji didnt exist before
        if (!data.updatedAt && createdEmoji.name) {
          emojisToSyncWithJson.push(createdEmoji);
        }

        missingEmojis++;
      } catch (error) {
        erroredEmojis++;
        console.error(`Failed to create emoji ${name}:`, error);
      }
    }

    spinner.edit(`${indexStr} ${greyText(`Skipping emoji ${name} creation, already exists.`)}`);
  }

  if (erroredEmojis) {
    spinner.stop(
      `Finished syncing emojis with Discord. ${redText(`${erroredEmojis} emoji(s)`)} failed to create.`,
    );
  }

  const createdEmojis = missingEmojis - erroredEmojis;

  const successMsg = stripIndent`
    ${greenText('✓ Sync Complete!')}
       ${greyText('- Total emojis processed')}: ${requiredEmojisArray.length}
       ${greyText('- Created')}: ${createdEmojis}
       ${greyText('- Skipped (already exist)')}: ${requiredEmojisArray.length - missingEmojis}
       ${greyText('- Failed')}: ${erroredEmojis}
  `;

  spinner.stop(successMsg);

  if (emojisToSyncWithJson.length > 0) {
    await updateEmojiJson(emojisToSyncWithJson);
  }
}

/**
 *
 * @param {import('discord.js').APIEmoji[]} emojis
 */
async function updateEmojiJson(emojis) {
  const newSpinner = new Spinner();
  newSpinner.start('Updating emojis.json with new emoji IDs...');
  /**
   * @type {Record<keyof typeof requiredEmojis, string>}
   */
  // @ts-ignore
  const newEmojis = emojis
    .filter((e) => e.name)
    .reduce((acc, emoji) => {
      // @ts-ignore
      acc[emoji.name] = {
        url: getEmojiUrl(emoji),
        updatedAt: getTimestampFromSnowflake(emoji.id).toISOString(),
      };
      return acc;
    }, {});

  const updatedEmojiSet = { ...requiredEmojis, ...newEmojis };

  await Bun.write(jsonFile, JSON.stringify(updatedEmojiSet, null, 2));
  newSpinner.stop(
    `${orangeText('ⓘ')} Added ${emojis.length} emoji(s) with new emoji ID(s) to emojis.json file.`,
  );
}

/**
 * @param {import("discord.js").APIEmoji} emoji
 */
function getEmojiUrl(emoji) {
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
}

// Fetch an emoji image
/**
 * @param {string} url
 */
async function fetchEmojiImage(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return urlToDataUri(url);
  } else if (/^\.{0,2}\/|^[a-zA-Z]:\\/.test(url)) {
    const fileData = Bun.file(url);
    return bufferToDataUri(Buffer.from(await fileData.arrayBuffer()), fileData.type);
  }

  throw new Error('Invalid URL or file path.');
}

async function fetchEmojis() {
  /**
   * @type {{items: {name: string, id: string}[]}}
   */
  // @ts-ignore
  const fetched = await rest.get(route);
  fetched.items.forEach((emoji) => APIEmojiCollection.set(emoji.name, emoji));
}
/**
 *
 * @param {{name: string, image: string}} emoji
 * @returns
 */
async function createEmoji(emoji) {
  /** @type {import('discord.js').APIEmoji} */
  // @ts-ignore
  const created = await rest.post(route, { body: emoji });
  if (created.name) APIEmojiCollection.set(created.name, created);
  return created;
}

/**
 * @param {string} url
 */
async function urlToDataUri(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const buffer = await response.arrayBuffer();
    return bufferToDataUri(Buffer.from(buffer), contentType ?? 'image/png');
  } catch (error) {
    throw new Error(`Error converting url to data URI: ${error.message}`);
  }
}

/**
 *
 * @param {Buffer} buffer
 * @returns
 */
async function bufferToDataUri(buffer, contentType = 'image/png') {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

/**
 * @param {string | null} emojiId
 */
async function deleteEmoji(emojiId) {
  if (!emojiId) {
    throw new Error('Invalid emoji ID.');
  }

  if (CLIENT_ID) {
    const emojiRoute = Routes.applicationEmoji(CLIENT_ID, emojiId);
    return rest.delete(emojiRoute);
  }
  throw new Error('Missing client ID.');
}

initialize();
