export interface SkillModelConfig {
  provider?: string;   // e.g., 'openai', 'anthropic', 'glm', 'openai-compatible'
  model: string;       // model id or nickname (e.g., 'gpt-5.4', 'sonnet', 'claude-haiku-4-5-20251001')
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  allowedTools?: string[];
  priority?: number;
  // Dynamic arguments
  args?: string[];               // Declared argument names, e.g., ['environment', 'service']
  // Per-skill model selection
  model?: SkillModelConfig;      // Preferred model for this skill
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
  allowedTools?: string[];
  priority: number;
  basePath: string;
  source: string;
  frontmatter: SkillFrontmatter;
  bodyCache?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  tags: string[];
  allowedTools?: string[];
}

export interface SkillRegistry {
  get(name: string): Skill | undefined;
  getAll(): Skill[];
  getMetadata(): SkillMetadata[];
  getBody(name: string): Promise<string | undefined>;
}
