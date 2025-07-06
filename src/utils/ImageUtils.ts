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

import Constants from '#utils/Constants.js';
import Logger from '#utils/Logger.js';
import { CanvasRenderingContext2D } from 'canvas';

/**
 * Returns the URL of an attachment in a message, if it exists.
 * @param message The message to search for an attachment URL.
 * @returns The URL of the attachment, or null if no attachment is found.
 */
export const getAttachmentURL = async (string: string) => {
  const URLMatch = string.match(Constants.Regex.VideoURL);
  if (URLMatch) return URLMatch[0];

  // Tenor Gifs
  const gifMatch = string.match(Constants.Regex.TenorLinks);
  if (!gifMatch) return null;

  try {
    if (!process.env.TENOR_KEY) throw new TypeError('Tenor API key not found in .env file.');
    const id = gifMatch[0].split('-').at(-1);
    const url = `https://g.tenor.com/v1/gifs?ids=${id}&key=${process.env.TENOR_KEY}`;
    const gifJSON = (await (await fetch(url)).json()) as {
      results: { media: { gif: { url: string } }[] }[];
    };

    return gifJSON.results.at(0)?.media.at(0)?.gif.url as string | null;
  }
  catch (e) {
    Logger.error(e);
    return null;
  }
};

export const stripTenorLinks = (content: string, imgUrl: string) =>
  content.replace(Constants.Regex.TenorLinks, '').replace(imgUrl, '');

export const drawRankProgressBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  progress: number,
  backgroundColor = '#484b4e',
  progressColor = Constants.Colors.primary,
): void => {
  // Draw background
  ctx.fillStyle = backgroundColor;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();

  // Draw progress
  const progressWidth = (width - 4) * Math.min(Math.max(progress, 0), 1);
  if (progressWidth > 0) {
    ctx.fillStyle = progressColor;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, progressWidth, height - 4, (height - 4) / 2);
    ctx.fill();
  }
};
