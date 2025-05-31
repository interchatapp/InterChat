// @ts-check

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

import { PrismaClient } from '#src/generated/prisma/client/client.js';

/**
 * Seeds the database with default achievements
 */
export async function seedAchievements(prisma: PrismaClient): Promise<void> {
  // Delete existing achievements
  await prisma.achievement.deleteMany({});

  // Define all achievement details
  const achievements = [
    // Connection achievements
    {
      id: 'world-tour',
      name: 'World Tour',
      description: 'Chat in 10+ different servers to unlock a globe badge.',
      badgeEmoji: '🌎',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },
    {
      id: 'bridge-builder',
      name: 'Bridge Builder',
      description: 'Link your server to a hub for the first time.',
      badgeEmoji: '🌉',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    {
      id: 'global-chatter',
      name: 'Global Chatter',
      description: 'Send 100+ messages across all hubs.',
      badgeEmoji: '💬',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 100,
    },
    {
      id: 'message-marathoner',
      name: 'Message Marathoner',
      description: 'Send 1,000+ messages in total.',
      badgeEmoji: '📨',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1000,
    },
    {
      id: 'streak-master',
      name: 'Streak Master',
      description: 'Send messages for 30 consecutive days.',
      badgeEmoji: '🔥',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 30,
    },

    // Interaction achievements
    {
      id: 'cross-cultural-ambassador',
      name: 'Cross-Cultural Ambassador',
      description: 'Receive reactions from users in 5+ different servers.',
      badgeEmoji: '🤝',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 5,
    },
    {
      id: 'chain-reaction',
      name: 'Chain Reaction',
      description: 'Trigger a conversation with 10+ replies from different servers.',
      badgeEmoji: '⛓️',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },
    {
      id: 'social-butterfly',
      name: 'Social Butterfly',
      description: 'Have your message replied to by users in 5+ servers.',
      badgeEmoji: '🦋',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 5,
    },
    // Hub engagement achievements
    {
      id: 'hub-hopper',
      name: 'Hub Hopper',
      description: 'Participate in 3+ different hubs.',
      badgeEmoji: '🦘',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 3,
    },
    {
      id: 'interconnected',
      name: 'Interconnected',
      description: 'Join a hub that connects 10+ servers.',
      badgeEmoji: '🔄',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },

    // Special achievements
    {
      id: 'echo-chamber',
      name: 'Echo Chamber',
      description: 'Your message is broadcast to 10+ servers in one hub.',
      badgeEmoji: '📣',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },
    // FIXME: implement: {
    //   id: 'inter-completionist',
    //   name: 'InterCompletionist',
    //   description: 'Unlock all other achievements.',
    //   badgeEmoji: '🏅',
    //   badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
    //   threshold: 1,
    // },
    // {
    //   id: 'night-owl',
    //   name: 'Night Owl',
    //   description: 'Send messages between 2-4 AM in any hub.',
    //   badgeEmoji: '🦉',
    //   badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
    //   threshold: 1,
    // },
    // {
    //   id: 'early-bird',
    //   name: 'Early Bird',
    //   description: 'Send messages between 5-7 AM in any hub.',
    //   badgeEmoji: '🐔',
    //   badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
    //   threshold: 1,
    // },
    {
      id: 'intercompletionist',
      name: 'InterCompletionist',
      description: 'Unlock all other achievements.',
      badgeEmoji: '🏅',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
      secret: true,
    },
    {
      id: 'golden-webhook',
      name: 'Golden Webhook',
      description: "Celebrate InterChat's anniversary by being active during its birthday month.",
      badgeEmoji: '🪝',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
      secret: true,
    },
    {
      id: 'archive-explorer',
      name: 'Archive Explorer',
      description: 'View the oldest archived message in a hub.',
      badgeEmoji: '📚',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    {
      id: 'bridge-booster',
      name: 'Bridge Booster',
      description: 'Help troubleshoot a hub connection issue (validated by moderators).',
      badgeEmoji: '🔧',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    {
      id: 'polyglot',
      name: 'Polyglot',
      description: 'Use the bot in 3+ languages.',
      badgeEmoji: '🗣️',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 3,
    },
    {
      id: 'first-steps',
      name: 'First Steps',
      description: 'Send your first message.',
      badgeEmoji: '🚀',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    // Voting achievements
    {
      id: 'voter',
      name: 'Voter',
      description: 'Vote 10 times on Top.gg.',
      badgeEmoji: '🗳️',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },
    {
      id: 'super-voter',
      name: 'Super Voter',
      description: 'Vote 100 times on Top.gg.',
      badgeEmoji: '⭐',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 100,
    },
    {
      id: 'voting-week-streaker',
      name: 'Voting Week Streaker',
      description: 'Vote for 7 consecutive days. (7 continuous votes)',
      badgeEmoji: '📅',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 7,
    },
    {
      id: 'voting-month-streaker',
      name: 'Voting Month Streaker',
      description: 'Vote for 30 consecutive days. (30 continuous votes)',
      badgeEmoji: '📆',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 30,
    },
    {
      id: 'voting-dedication',
      name: 'Voting Dedication',
      description: 'Vote for 100 consecutive days. (100 continuous votes)',
      badgeEmoji: '🏆',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 100,
    },
    // Hub creation achievements
    {
      id: 'hub-creator',
      name: 'Hub Creator',
      description: 'Create a hub.',
      badgeEmoji: '🏗️',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    {
      id: 'viral-hub',
      name: 'Viral Hub',
      description: 'Get more than 25 servers in your hub.',
      badgeEmoji: '📈',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 25,
    },
    {
      id: 'hub-empire',
      name: 'Hub Empire',
      description: 'Achieve 100 servers in your hub.',
      badgeEmoji: '👑',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 100,
    },

    // Call-related achievements
    {
      id: 'first-caller',
      name: 'First Caller',
      description: 'Make your first call using InterChat.',
      badgeEmoji: '📞',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1,
    },
    {
      id: 'call-veteran',
      name: 'Call Veteran',
      description: 'Complete 10 calls successfully.',
      badgeEmoji: '🎖️',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 10,
    },
    {
      id: 'call-master',
      name: 'Call Master',
      description: 'Complete 50 calls successfully.',
      badgeEmoji: '🏅',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 50,
    },
    {
      id: 'marathon-caller',
      name: 'Marathon Caller',
      description: 'Stay in a call for 30+ minutes.',
      badgeEmoji: '⏰',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 1800, // 30 minutes in seconds
    },
    {
      id: 'social-butterfly',
      name: 'Social Butterfly',
      description: 'Participate in a call with 5+ people.',
      badgeEmoji: '🦋',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 5,
    },
    {
      id: 'conversation-starter',
      name: 'Conversation Starter',
      description: 'Send 100+ messages during calls.',
      badgeEmoji: '💭',
      badgeUrl: 'https://images.emojiterra.com/twitter/512px/1f389.png',
      threshold: 100,
    },
  ];

  // Insert achievements using upsert to preserve existing user data
  console.log('Seeding achievements...');
  let upsertedCount = 0;

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { id: achievement.id },
      update: {
        name: achievement.name,
        description: achievement.description,
        badgeEmoji: achievement.badgeEmoji,
        badgeUrl: achievement.badgeUrl,
        threshold: achievement.threshold,
      },
      create: achievement,
    });
    upsertedCount++;
  }

  console.log(`Seeded ${upsertedCount} achievements (using upsert to preserve user data).`);
}

const prisma = new PrismaClient();

seedAchievements(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
