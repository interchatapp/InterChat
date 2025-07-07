import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';

/**
 * Tag Management Service
 * Handles tag creation, autocomplete, and categorization for enhanced hub discovery
 * Supports the simplified hub system with focus on core retention features
 */
export class TagManagementService {
  private readonly MAX_TAGS_PER_HUB = 5;

  /**
   * Get popular tags for autocomplete with caching
   */
  async getPopularTags(
    limit = 50,
  ): Promise<Array<{ name: string; usageCount: number; category: string | null }>> {
    try {
      // Get tags ordered by usage count
      const tags = await db.tag.findMany({
        orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
        take: limit,
        select: {
          name: true,
          usageCount: true,
          category: true,
          isOfficial: true,
        },
      });

      return tags;
    }
    catch (error) {
      Logger.error('Failed to fetch popular tags:', error);
      return this.getDefaultTags();
    }
  }

  /**
   * Search tags for autocomplete functionality
   */
  async searchTags(
    query: string,
    limit = 20,
  ): Promise<Array<{ name: string; category: string | null; isOfficial: boolean }>> {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const tags = await db.tag.findMany({
        where: {
          name: {
            contains: query,
            mode: 'insensitive',
          },
        },
        orderBy: [
          { isOfficial: 'desc' }, // Official tags first
          { usageCount: 'desc' },
          { name: 'asc' },
        ],
        take: limit,
        select: {
          name: true,
          category: true,
          isOfficial: true,
        },
      });

      return tags;
    }
    catch (error) {
      Logger.error('Failed to search tags:', error);
      return [];
    }
  }

  /**
   * Create or get existing tag
   */
  async createOrGetTag(name: string, category?: string): Promise<{ id: string; name: string }> {
    const normalizedName = name.toLowerCase().trim();

    if (!normalizedName || normalizedName.length > 30) {
      throw new Error('Invalid tag name');
    }

    try {
      // Try to find existing tag
      let tag = await db.tag.findUnique({
        where: { name: normalizedName },
        select: { id: true, name: true },
      });

      if (!tag) {
        // Create new tag
        tag = await db.tag.create({
          data: {
            name: normalizedName,
            category: category || this.categorizeTag(normalizedName),
            isOfficial: false,
            usageCount: 1,
          },
          select: { id: true, name: true },
        });

        Logger.info(`Created new tag: ${normalizedName}`);
      }
      else {
        // Increment usage count
        await db.tag.update({
          where: { id: tag.id },
          data: { usageCount: { increment: 1 } },
        });
      }

      return tag;
    }
    catch (error) {
      Logger.error('Failed to create or get tag:', error);
      throw new Error('Failed to process tag');
    }
  }

  /**
   * Add tags to a hub with validation
   */
  async addTagsToHub(hubId: string, tagNames: string[]): Promise<void> {
    if (tagNames.length > this.MAX_TAGS_PER_HUB) {
      throw new Error(`Maximum ${this.MAX_TAGS_PER_HUB} tags allowed per hub`);
    }

    try {
      // Get or create all tags
      const tags = await Promise.all(tagNames.map((name) => this.createOrGetTag(name)));

      // Connect tags to hub
      await db.hub.update({
        where: { id: hubId },
        data: {
          tags: {
            connect: tags.map((tag) => ({ id: tag.id })),
          },
        },
      });

      Logger.info(`Added ${tags.length} tags to hub ${hubId}`);
    }
    catch (error) {
      Logger.error('Failed to add tags to hub:', error);
      throw new Error('Failed to add tags to hub');
    }
  }

  /**
   * Remove tags from a hub
   */
  async removeTagsFromHub(hubId: string, tagNames: string[]): Promise<void> {
    try {
      const tags = await db.tag.findMany({
        where: {
          name: { in: tagNames.map((name) => name.toLowerCase()) },
        },
        select: { id: true },
      });

      await db.hub.update({
        where: { id: hubId },
        data: {
          tags: {
            disconnect: tags.map((tag) => ({ id: tag.id })),
          },
        },
      });

      Logger.info(`Removed ${tags.length} tags from hub ${hubId}`);
    }
    catch (error) {
      Logger.error('Failed to remove tags from hub:', error);
      throw new Error('Failed to remove tags from hub');
    }
  }

  /**
   * Get tags by category for organized display
   */
  async getTagsByCategory(): Promise<Record<string, Array<{ name: string; usageCount: number }>>> {
    try {
      const tags = await db.tag.findMany({
        where: {
          usageCount: { gt: 0 }, // Only include used tags
        },
        orderBy: [{ category: 'asc' }, { usageCount: 'desc' }],
        select: {
          name: true,
          category: true,
          usageCount: true,
        },
      });

      const categorized: Record<string, Array<{ name: string; usageCount: number }>> = {};

      tags.forEach((tag) => {
        const category = tag.category || 'Other';
        if (!categorized[category]) {
          categorized[category] = [];
        }
        categorized[category].push({
          name: tag.name,
          usageCount: tag.usageCount,
        });
      });

      return categorized;
    }
    catch (error) {
      Logger.error('Failed to get tags by category:', error);
      return {};
    }
  }

  /**
   * Initialize official tags for the platform
   */
  async initializeOfficialTags(): Promise<void> {
    const officialTags = [
      { name: 'gaming', category: 'Gaming', color: '#10B981' },
      { name: 'technology', category: 'Technology', color: '#3B82F6' },
      { name: 'art', category: 'Creative', color: '#8B5CF6' },
      { name: 'music', category: 'Creative', color: '#F59E0B' },
      { name: 'anime', category: 'Entertainment', color: '#EF4444' },
      { name: 'programming', category: 'Technology', color: '#06B6D4' },
      { name: 'community', category: 'Social', color: '#84CC16' },
      { name: 'education', category: 'Learning', color: '#6366F1' },
      { name: 'memes', category: 'Entertainment', color: '#F97316' },
      { name: 'sports', category: 'Sports', color: '#14B8A6' },
    ];

    try {
      for (const tagData of officialTags) {
        await db.tag.upsert({
          where: { name: tagData.name },
          update: {
            isOfficial: true,
            category: tagData.category,
            color: tagData.color,
          },
          create: {
            name: tagData.name,
            category: tagData.category,
            color: tagData.color,
            isOfficial: true,
            usageCount: 0,
          },
        });
      }

      Logger.info(`Initialized ${officialTags.length} official tags`);
    }
    catch (error) {
      Logger.error('Failed to initialize official tags:', error);
    }
  }

  /**
   * Automatically categorize a tag based on its name
   */
  private categorizeTag(tagName: string): string {
    const categories = {
      Gaming: ['game', 'gaming', 'esports', 'minecraft', 'fortnite', 'valorant', 'league'],
      Technology: ['tech', 'programming', 'coding', 'dev', 'software', 'ai', 'ml'],
      Creative: ['art', 'music', 'design', 'creative', 'drawing', 'photography'],
      Entertainment: ['anime', 'movies', 'tv', 'memes', 'funny', 'entertainment'],
      Social: ['community', 'chat', 'social', 'friends', 'hangout'],
      Learning: ['education', 'study', 'learning', 'school', 'university'],
      Sports: ['sports', 'football', 'basketball', 'soccer', 'fitness'],
    };

    const lowerName = tagName.toLowerCase();

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some((keyword) => lowerName.includes(keyword))) {
        return category;
      }
    }

    return 'Other';
  }

  /**
   * Get default tags when database is unavailable
   */
  private getDefaultTags(): Array<{ name: string; usageCount: number; category: string | null }> {
    return [
      { name: 'gaming', usageCount: 100, category: 'Gaming' },
      { name: 'technology', usageCount: 80, category: 'Technology' },
      { name: 'art', usageCount: 70, category: 'Creative' },
      { name: 'music', usageCount: 65, category: 'Creative' },
      { name: 'community', usageCount: 60, category: 'Social' },
    ];
  }
}
