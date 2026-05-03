// Loads all course markdown at build time via Vite's `import.meta.glob`.
//
// Files are stored under `content/` next to the package source. The first
// path segment after `content/` is the chapter slug (e.g. `00-introduction`),
// the optional second segment is the lesson slug (e.g. `02-the-big-picture`),
// and a missing lesson means the file is the chapter README. The top-level
// `content/README.md` is treated as the course landing page.

const RAW_MD = import.meta.glob("../../content/**/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export interface Lesson {
	chapterSlug: string;
	lessonSlug: string; // empty string for the chapter README
	title: string;
	source: string;
	path: string; // canonical hash path (without leading "#")
	order: number;
}

export interface Chapter {
	slug: string;
	title: string;
	order: number;
	readme: Lesson; // every chapter has a README
	lessons: Lesson[]; // does NOT include the README
	allPages: Lesson[]; // README first, then lessons in order
}

export interface CourseTree {
	root: Lesson; // top-level README.md
	chapters: Chapter[];
	flatPages: Lesson[]; // root + every chapter README + lesson, in reading order
}

const CONTENT_PREFIX = "../../content/";

function stripPrefix(path: string): string {
	if (!path.startsWith(CONTENT_PREFIX)) {
		throw new Error(`Unexpected content path: ${path}`);
	}
	return path.slice(CONTENT_PREFIX.length);
}

// Pull a human title from markdown — first H1 wins, otherwise prettify the slug.
function extractTitle(source: string, fallback: string): string {
	const match = source.match(/^#\s+(.+?)\s*$/m);
	if (match) return match[1].trim();
	return prettifySlug(fallback);
}

function prettifySlug(slug: string): string {
	return slug
		.replace(/^\d+[-_]?/, "")
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse a numeric prefix like "03-foo" → 3; missing prefix sorts last.
function parseOrder(slug: string): number {
	const m = slug.match(/^(\d+)/);
	return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

interface RawEntry {
	chapterSlug: string;
	lessonSlug: string; // "" for chapter README
	source: string;
	rel: string; // path relative to content/
}

function classify(rel: string, source: string): RawEntry | null {
	const parts = rel.split("/");
	// Top-level README → root page (handled separately, not a chapter)
	if (parts.length === 1) {
		if (parts[0].toLowerCase() === "readme.md") return null;
		throw new Error(`Unexpected top-level content file: ${rel}`);
	}
	const [chapterSlug, file] = parts.length === 2 ? parts : [parts[0], parts.slice(1).join("/")];
	if (file.toLowerCase() === "readme.md") {
		return { chapterSlug, lessonSlug: "", source, rel };
	}
	if (!file.endsWith(".md")) return null;
	const lessonSlug = file.replace(/\.md$/, "");
	return { chapterSlug, lessonSlug, source, rel };
}

let cached: CourseTree | null = null;

export function loadCourse(): CourseTree {
	if (cached) return cached;

	let rootSource: string | null = null;
	const byChapter = new Map<string, { readme?: RawEntry; lessons: RawEntry[] }>();

	for (const [absPath, source] of Object.entries(RAW_MD)) {
		const rel = stripPrefix(absPath);
		if (rel.toLowerCase() === "readme.md") {
			rootSource = source;
			continue;
		}
		const entry = classify(rel, source);
		if (!entry) continue;
		const bucket = byChapter.get(entry.chapterSlug) ?? { lessons: [] };
		if (entry.lessonSlug === "") bucket.readme = entry;
		else bucket.lessons.push(entry);
		byChapter.set(entry.chapterSlug, bucket);
	}

	if (!rootSource) {
		// Synthesize a minimal root page if it's missing.
		rootSource = "# Course\n\nWelcome.\n";
	}

	const chapters: Chapter[] = [...byChapter.entries()]
		.map(([slug, bucket]) => {
			if (!bucket.readme) {
				// Synthesize a chapter README if one is missing — keeps nav coherent.
				bucket.readme = {
					chapterSlug: slug,
					lessonSlug: "",
					source: `# ${prettifySlug(slug)}\n`,
					rel: `${slug}/README.md`,
				};
			}
			const order = parseOrder(slug);
			const readmeLesson: Lesson = {
				chapterSlug: slug,
				lessonSlug: "",
				title: extractTitle(bucket.readme.source, slug),
				source: bucket.readme.source,
				path: `/${slug}/`,
				order,
			};
			const lessons = bucket.lessons
				.map<Lesson>((e) => ({
					chapterSlug: slug,
					lessonSlug: e.lessonSlug,
					title: extractTitle(e.source, e.lessonSlug),
					source: e.source,
					path: `/${slug}/${e.lessonSlug}`,
					order: parseOrder(e.lessonSlug),
				}))
				.sort((a, b) => a.order - b.order || a.lessonSlug.localeCompare(b.lessonSlug));

			return {
				slug,
				title: readmeLesson.title,
				order,
				readme: readmeLesson,
				lessons,
				allPages: [readmeLesson, ...lessons],
			} satisfies Chapter;
		})
		.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

	const root: Lesson = {
		chapterSlug: "",
		lessonSlug: "",
		title: extractTitle(rootSource, "course"),
		source: rootSource,
		path: "/",
		order: -1,
	};

	const flatPages: Lesson[] = [root];
	for (const ch of chapters) flatPages.push(...ch.allPages);

	cached = { root, chapters, flatPages };
	return cached;
}

export function findPage(tree: CourseTree, path: string): Lesson | null {
	const normalized = normalizePath(path);
	if (normalized === "/") return tree.root;
	for (const page of tree.flatPages) {
		if (page.path === normalized) return page;
	}
	// Tolerate trailing-slash mismatch on chapter pages.
	if (normalized.endsWith("/")) {
		const stripped = normalized.slice(0, -1);
		const hit = tree.flatPages.find((p) => p.path === stripped);
		if (hit) return hit;
	} else {
		const hit = tree.flatPages.find((p) => p.path === `${normalized}/`);
		if (hit) return hit;
	}
	return null;
}

export function normalizePath(path: string): string {
	if (!path) return "/";
	let p = path.trim();
	if (!p.startsWith("/")) p = `/${p}`;
	// Collapse duplicate slashes.
	p = p.replace(/\/{2,}/g, "/");
	return p;
}

export function getNeighbors(
	tree: CourseTree,
	page: Lesson,
): { prev: Lesson | null; next: Lesson | null } {
	const idx = tree.flatPages.findIndex((p) => p.path === page.path);
	if (idx === -1) return { prev: null, next: null };
	return {
		prev: idx > 0 ? tree.flatPages[idx - 1] : null,
		next: idx < tree.flatPages.length - 1 ? tree.flatPages[idx + 1] : null,
	};
}
