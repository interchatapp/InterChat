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

/**
 * Sorts the reactions object based on the reaction counts.
 * @param reactions - The reactions object to be sorted.
 * @returns The sorted reactions object in the form of an array.
 * The array is sorted in descending order based on the length of the reaction arrays.
 * Each element of the array is a tuple containing the reaction and its corresponding array of user IDs.
 *
 * **Before:**
 * ```ts
 *  { '👍': ['10201930193'], '👎': ['10201930193', '10201930194'] }
 * ```
 * **After:**
 * ```ts
 * [ [ '👎', ['10201930193', '10201930194'] ], [ '👍', ['10201930193'] ] ]
 * ```
 * */
export default (reactions: { [key: string]: string[] }): [string, string[]][] => {
  const idk = Object.entries(reactions).sort((a, b) => b[1].length - a[1].length);
  return idk;
};
