import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const films = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/films' }),
  schema: z.object({
    title: z.string(),
    director: z.string(),
    year: z.number().optional(),
    poster: z.string().optional(),
    synopsis: z.string().optional(),
    featured: z.boolean().default(false),
    originalTitle: z.string().optional(),
    screenwriter: z.string().optional(),
    producers: z.array(z.string()).default([]),
    coProducers: z.array(z.string()).default([]),
    sales: z.string().optional(),
    trailerUrl: z.string().optional(),
    imdbUrl: z.string().optional(),
    stills: z.array(z.string()).default([]),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    intro: z.string().default(''),
    paragraphs: z.array(z.string()).default([]),
    email: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/people' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    portrait: z.string().optional(),
    bio: z.array(z.string()).default([]),
    email: z.string().optional(),
    order: z.number().default(100),
  }),
});

export const collections = { films, pages, people };
