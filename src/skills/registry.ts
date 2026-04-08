import { Skill, SkillMetadata, SkillRegistry } from './types.js';

export class DefaultSkillRegistry implements SkillRegistry {
  private skills: Map<string, Skill>;
  private bodyCache: Map<string, string>;
  private readonly maxCacheSize = 5;

  constructor(skills: Skill[]) {
    this.skills = new Map(skills.map(s => [s.name, s]));
    this.bodyCache = new Map();
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  getMetadata(): SkillMetadata[] {
    return this.getAll().map(s => ({
      name: s.name,
      description: s.description,
      version: s.version,
      tags: s.tags,
      allowedTools: s.allowedTools,
    }));
  }

  async getBody(name: string): Promise<string | undefined> {
    const skill = this.get(name);
    if (!skill) return undefined;

    // Check cache first
    const cached = this.bodyCache.get(name);
    if (cached) return cached;

    // Use pre-loaded body from parse
    if (skill.bodyCache) {
      this.setCache(name, skill.bodyCache);
      return skill.bodyCache;
    }

    return undefined;
  }

  private setCache(name: string, body: string): void {
    this.bodyCache.delete(name); // Remove if exists (moves to end)
    this.bodyCache.set(name, body);

    // Evict oldest
    if (this.bodyCache.size > this.maxCacheSize) {
      const firstKey = this.bodyCache.keys().next().value as string;
      if (firstKey) this.bodyCache.delete(firstKey);
    }
  }

  getNames(): string[] {
    return Array.from(this.skills.keys());
  }
}
