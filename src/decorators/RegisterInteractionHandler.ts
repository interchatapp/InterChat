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

import type { Awaitable, MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';
import 'reflect-metadata';

export type InteractionFunction = (
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
) => Awaitable<unknown>;

/** Decorator to call a specified method when an interaction is created (ie. interactionCreate event) */
export function RegisterInteractionHandler(prefix: string, suffix = ''): MethodDecorator {
  return (targetClass, propertyKey: string | symbol) => {
    const realSuffix = suffix ? `:${suffix}` : '';
    const customId = `${prefix}${realSuffix}`;

    const newMeta = [{ customId, methodName: propertyKey }];
    const existing = Reflect.getMetadata('interactions', targetClass.constructor);

    const metadata = existing ? [...existing, ...newMeta] : newMeta;
    Reflect.defineMetadata('interactions', metadata, targetClass.constructor);
  };
}
