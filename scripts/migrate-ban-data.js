// @ts-check
import 'dotenv/config';
import { PrismaClient } from '../build/generated/prisma/client/client.js';
import { Spinner, greenText, redText } from './utils.js';

// Initialize Prisma client
const db = new PrismaClient({
  errorFormat: 'minimal',
});

/**
 * Migrate existing ban data from User.banReason to the new Ban model
 */
async function migrateBanData() {
  const spinner = new Spinner();
  
  try {
    console.log('🔄 Starting ban data migration...\n');
    
    // Find all users with banReason set
    spinner.start('Finding users with existing bans...');
    const bannedUsers = await db.user.findMany({
      where: {
        banReason: {
          not: null,
        },
      },
      select: {
        id: true,
        banReason: true,
        createdAt: true,
      },
    });
    
    spinner.stop(`Found ${bannedUsers.length} users with existing bans`);
    
    if (bannedUsers.length === 0) {
      console.log(greenText('✅ No existing bans found. Migration complete.'));
      return;
    }
    
    // Create Ban records for each banned user
    spinner.start('Creating Ban records...');
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of bannedUsers) {
      try {
        // Check if a ban already exists for this user
        const existingBan = await db.ban.findFirst({
          where: {
            userId: user.id,
            status: 'ACTIVE',
          },
        });
        
        if (existingBan) {
          console.log(`⚠️  Ban already exists for user ${user.id}, skipping...`);
          continue;
        }
        
        // Create a new ban record
        await db.ban.create({
          data: {
            userId: user.id,
            moderatorId: 'system', // Use 'system' as moderator for migrated bans
            reason: user.banReason || 'Migrated from legacy ban system',
            type: 'PERMANENT', // All legacy bans are permanent
            status: 'ACTIVE',
            // Use the user's creation date as a fallback for ban creation date
            createdAt: user.createdAt,
          },
        });
        
        successCount++;
      } catch (error) {
        console.error(`❌ Error creating ban for user ${user.id}:`, error.message);
        errorCount++;
      }
    }
    
    spinner.stop(`Created ${successCount} ban records`);
    
    if (errorCount > 0) {
      console.log(redText(`⚠️  ${errorCount} errors occurred during migration`));
    }
    
    // Verify migration
    spinner.start('Verifying migration...');
    const totalBans = await db.ban.count();
    const activeBans = await db.ban.count({
      where: { status: 'ACTIVE' },
    });
    
    spinner.stop(`Verification complete: ${totalBans} total bans, ${activeBans} active bans`);
    
    console.log('\n📊 Migration Summary:');
    console.log(`  • Users with legacy bans: ${bannedUsers.length}`);
    console.log(`  • Ban records created: ${successCount}`);
    console.log(`  • Errors: ${errorCount}`);
    console.log(`  • Total bans in system: ${totalBans}`);
    console.log(`  • Active bans: ${activeBans}`);
    
    if (successCount === bannedUsers.length && errorCount === 0) {
      console.log(greenText('\n✅ Ban data migration completed successfully!'));
      console.log('\n⚠️  Note: User.banReason fields are still present.');
      console.log('   Run the cleanup script after verifying the migration.');
    } else {
      console.log(redText('\n❌ Migration completed with errors. Please review the logs.'));
    }
    
  } catch (error) {
    spinner.stop();
    console.error(redText('❌ Migration failed:'), error);
    throw error;
  }
}

/**
 * Clean up legacy banReason fields after successful migration
 */
async function cleanupLegacyBanFields() {
  const spinner = new Spinner();
  
  try {
    console.log('\n🧹 Starting cleanup of legacy ban fields...');
    
    // Count users with banReason set
    spinner.start('Counting users with legacy ban fields...');
    const usersWithBanReason = await db.user.count({
      where: {
        banReason: {
          not: null,
        },
      },
    });
    
    spinner.stop(`Found ${usersWithBanReason} users with legacy ban fields`);
    
    if (usersWithBanReason === 0) {
      console.log(greenText('✅ No legacy ban fields found. Cleanup complete.'));
      return;
    }
    
    // Clear banReason fields
    spinner.start('Clearing legacy ban fields...');
    const result = await db.user.updateMany({
      where: {
        banReason: {
          not: null,
        },
      },
      data: {
        banReason: null,
      },
    });
    
    spinner.stop(`Cleared ${result.count} legacy ban fields`);
    
    console.log(greenText('\n✅ Legacy ban field cleanup completed successfully!'));
    
  } catch (error) {
    spinner.stop();
    console.error(redText('❌ Cleanup failed:'), error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    await migrateBanData();
    
    // Ask user if they want to clean up legacy fields
    console.log('\n❓ Do you want to clean up legacy ban fields now? (y/N)');
    console.log('   This will remove User.banReason fields after migration.');
    
    // For automated scripts, you can uncomment the line below to auto-cleanup
    // await cleanupLegacyBanFields();
    
  } catch (error) {
    console.error(redText('Migration script failed:'), error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

// Run the migration
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
