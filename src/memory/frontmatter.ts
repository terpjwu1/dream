import matter from "gray-matter";

export interface MemoryFrontmatter {
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/** Parse a memory file and assert the conventions proposals must follow. */
export function validateMemoryFile(content: string): MemoryFrontmatter {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err: unknown) {
    throw new Error(`Frontmatter does not parse: ${(err as Error).message}`);
  }
  const { name, description } = parsed.data ?? {};
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Frontmatter must include a non-empty `name`");
  }
  if (typeof description !== "string" || !description.trim()) {
    throw new Error("Frontmatter must include a non-empty `description`");
  }
  if (!parsed.content.trim()) {
    throw new Error("Memory body is empty");
  }
  return { name, description, metadata: parsed.data.metadata };
}
