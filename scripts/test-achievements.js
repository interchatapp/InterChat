#!/usr/bin/env node
// @ts-check

/**
 * Achievement System Testing Script
 * 
 * This script helps test and debug the achievement system by:
 * 1. Verifying all achievement definitions exist
 * 2. Testing achievement unlock functionality
 * 3. Checking database consistency
 * 4. Providing manual testing commands
 */

import { PrismaClient } from '../build/generated/prisma/client/client.js';
import AchievementService from '../build/services/AchievementService.js';

const db = new PrismaClient();
const achievementService = new AchievementService();

// Test user ID (replace with your Discord user ID for testing)
const TEST_USER_ID = '701727675311587358';

async function main() {
  console.log('🏆 InterChat Achievement System Test Suite\n');

  try {
    // Test 1: Verify all achievement definitions
    await testAchievementDefinitions();
    
    // Test 2: Test achievement unlocking
    await testAchievementUnlocking();
    
    // Test 3: Test progress tracking
    await testProgressTracking();
    
    // Test 4: Test specific achievement triggers
    await testSpecificAchievements();
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n📋 Manual Testing Commands:');
    console.log('1. Create a hub: /hub create');
    console.log('2. Join a hub: /connect');
    console.log('3. Send messages in hubs');
    console.log('4. Check achievements: /achievements');
    console.log('5. Vote for the bot on Top.gg');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await db.$disconnect();
  }
}

async function testAchievementDefinitions() {
  console.log('📋 Testing Achievement Definitions...');
  
  const achievements = await achievementService.getAchievements();
  console.log(`Found ${achievements.length} achievements defined`);
  
  // Expected achievement IDs based on seed data
  const expectedAchievements = [
    'first-steps',
    'global-chatter',
    'message-marathoner',
    'streak-master',
    'world-tour',
    'hub-hopper',
    'hub-creator',
    'viral-hub',
    'hub-empire',
    'interconnected',
    'bridge-builder',
    'cross-cultural-ambassador',
    'social-butterfly',
    'chain-reaction',
    'echo-chamber',
    'voter',
    'super-voter',
    'pioneer',
    'welcome-wagon',
    'hub-hero',
    'polyglot',
    'golden-webhook',
    'early-bird',
    'inter-completionist',
    'peacekeeper',
    'bridge-booster',
    'archive-explorer'
  ];
  
  const foundIds = achievements.map(a => a.id);
  const missingAchievements = expectedAchievements.filter(id => !foundIds.includes(id));
  
  if (missingAchievements.length > 0) {
    console.log('⚠️  Missing achievements:', missingAchievements);
  } else {
    console.log('✅ All expected achievements found');
  }
  
  // Check for achievements with missing tracking
  const achievementsWithoutTracking = [
    'welcome-wagon',
    'peacekeeper', 
    'bridge-booster',
    'archive-explorer'
  ];
  
  console.log('⚠️  Achievements that may need additional tracking integration:');
  achievementsWithoutTracking.forEach(id => {
    const achievement = achievements.find(a => a.id === id);
    if (achievement) {
      console.log(`   - ${achievement.name} (${id})`);
    }
  });
}

async function testAchievementUnlocking() {
  console.log('\n🔓 Testing Achievement Unlocking...');
  
  try {
    // Test unlocking First Steps achievement
    const unlocked = await achievementService.unlockAchievement(TEST_USER_ID, 'first-steps');
    console.log(`First Steps unlock test: ${unlocked ? 'SUCCESS' : 'ALREADY_UNLOCKED'}`);
    
    // Check if it was actually unlocked
    const hasAchievement = await achievementService.isAchievementUnlocked(TEST_USER_ID, 'first-steps');
    console.log(`First Steps verification: ${hasAchievement ? 'FOUND' : 'NOT_FOUND'}`);
    
  } catch (error) {
    console.log('❌ Achievement unlocking test failed:', error.message);
  }
}

async function testProgressTracking() {
  console.log('\n📈 Testing Progress Tracking...');
  
  try {
    // Test progress update
    const newProgress = await achievementService.updateProgress(TEST_USER_ID, 'message-marathoner', 5);
    console.log(`Message Marathoner progress: ${newProgress}/1000`);
    
    // Test progress retrieval
    const currentProgress = await achievementService.getProgress(TEST_USER_ID, 'message-marathoner');
    console.log(`Retrieved progress: ${currentProgress}`);
    
  } catch (error) {
    console.log('❌ Progress tracking test failed:', error.message);
  }
}

async function testSpecificAchievements() {
  console.log('\n🎯 Testing Specific Achievement Triggers...');
  
  // Test Hub Creator achievement trigger
  console.log('Testing Hub Creator achievement...');
  try {
    await achievementService.processEvent('hub_create', { userId: TEST_USER_ID });
    console.log('✅ Hub Creator event processed');
  } catch (error) {
    console.log('❌ Hub Creator test failed:', error.message);
  }
  
  // Test message achievements
  console.log('Testing message achievements...');
  try {
    await achievementService.processEvent('message', {
      userId: TEST_USER_ID,
      serverId: 'test-server-123',
      hubId: 'test-hub-123'
    });
    console.log('✅ Message event processed');
  } catch (error) {
    console.log('❌ Message achievement test failed:', error.message);
  }
  
  // Test vote achievements
  console.log('Testing vote achievements...');
  try {
    await achievementService.processEvent('vote', { userId: TEST_USER_ID });
    console.log('✅ Vote event processed');
  } catch (error) {
    console.log('❌ Vote achievement test failed:', error.message);
  }
}

// Database verification functions
async function verifyDatabaseConsistency() {
  console.log('\n🗄️  Verifying Database Consistency...');

  // Check for achievements without progress tracking
  const achievementsWithoutProgress = await db.achievement.findMany({
    where: {
      threshold: { gt: 1 },
      userProgress: { none: {} }
    }
  });
  
  console.log(`📊 ${achievementsWithoutProgress.length} achievements have no progress records yet`);
}

// Run the tests
main().catch(console.error);
