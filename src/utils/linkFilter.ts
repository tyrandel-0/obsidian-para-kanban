import type { App, BasesEntry } from 'obsidian';

/**
 * Hides cards based on a property of a *linked* note.
 *
 * Bases filters cannot dereference links — `link.asFile()` exposes file
 * metadata but never the target's frontmatter — so a rule like "hide tasks
 * whose project is frozen" is impossible to express in the base query. The
 * view can do it, because it has the metadata cache.
 *
 * The rule is stated without any domain vocabulary: a card has a link
 * property, the link resolves to a note, that note has a property; if its
 * value is in the stop-list, the card is not rendered.
 */
export interface LinkFilterConfig {
	/** Frontmatter key on the card that holds the link(s), e.g. `Project`. */
	linkProperty: string;
	/** Frontmatter key read on the linked note, e.g. `Status`. */
	targetProperty: string;
	/** Normalised stop-list; a card is hidden when its links all match one. */
	values: string[];
}

export interface LinkFilterResult {
	/** Entries that survived the filter, in their original order. */
	entries: BasesEntry[];
	hiddenCount: number;
	/**
	 * Paths of every linked note a value was read from. These notes are outside
	 * the base's query, so Bases never re-runs it when one of them changes —
	 * the view watches them itself.
	 */
	sources: Set<string>;
}

/** Scalars normalise to a comparable string; anything richer cannot match a text stop-list. */
function normalizeValue(value: unknown): string {
	if (typeof value === 'string') return value.trim().toLowerCase();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase();
	return '';
}

/** Frontmatter values may be scalars or lists; normalise both to a flat list. */
function readValues(frontmatter: Record<string, unknown> | undefined, key: string): string[] {
	const raw = frontmatter?.[key];
	if (raw === null || raw === undefined) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map(normalizeValue).filter((v) => v !== '');
}

/**
 * Builds a config from raw view options, or null when the filter is off.
 * `fallbackTargetProperty` is the group-by property name: in a self-similar
 * schema (a task and its project both carry `Status`) that is the sensible
 * default, so the user only fills in two fields.
 */
export function parseLinkFilterConfig(
	linkProperty: string | null,
	rawTargetProperty: unknown,
	rawValues: unknown,
	fallbackTargetProperty: string | null,
): LinkFilterConfig | null {
	if (!linkProperty) return null;

	const explicitTarget = typeof rawTargetProperty === 'string' ? rawTargetProperty.trim() : '';
	const targetProperty = explicitTarget || fallbackTargetProperty?.trim() || '';
	if (!targetProperty) return null;

	const rawList = Array.isArray(rawValues) ? rawValues : typeof rawValues === 'string' ? [rawValues] : [];
	const values = rawList.map(normalizeValue).filter((v) => v !== '');
	if (values.length === 0) return null;

	return { linkProperty, targetProperty, values };
}

/**
 * Applies the filter to a list of entries.
 *
 * A card is hidden only when *every* link it carries points at a matching
 * note: a task on two projects stays visible while one of them is still
 * running. Cards with no link, or whose links do not resolve, are always
 * kept — silently dropping a card is worse than showing one card too many.
 */
export function applyLinkFilter(
	entries: BasesEntry[],
	config: LinkFilterConfig,
	app: App | undefined,
): LinkFilterResult {
	const sources = new Set<string>();
	const metadataCache = app?.metadataCache;
	if (!metadataCache) return { entries, hiddenCount: 0, sources };

	const stopList = new Set(config.values);
	const prefix = `${config.linkProperty}.`;
	// path → does the linked note match the stop-list. One board can hold
	// hundreds of cards pointing at a handful of notes.
	const matchCache = new Map<string, boolean>();

	const kept = entries.filter((entry) => {
		const refs = metadataCache.getFileCache(entry.file)?.frontmatterLinks ?? [];
		// A list property yields `Project.0`, `Project.1`; a scalar yields `Project`.
		const links = refs.filter((ref) => ref.key === config.linkProperty || ref.key.startsWith(prefix));
		if (links.length === 0) return true;

		let resolved = 0;
		let matched = 0;
		for (const ref of links) {
			const target = metadataCache.getFirstLinkpathDest(ref.link, entry.file.path);
			if (!target) continue;
			resolved++;
			sources.add(target.path);

			const cached = matchCache.get(target.path);
			if (cached !== undefined) {
				if (cached) matched++;
				continue;
			}
			const frontmatter = metadataCache.getFileCache(target)?.frontmatter;
			const isMatch = readValues(frontmatter, config.targetProperty).some((v) => stopList.has(v));
			matchCache.set(target.path, isMatch);
			if (isMatch) matched++;
		}

		if (resolved === 0) return true;
		return matched < resolved;
	});

	return { entries: kept, hiddenCount: entries.length - kept.length, sources };
}
