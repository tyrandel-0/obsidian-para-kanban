import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { App, BasesEntry, BasesPropertyId } from 'obsidian';
import { CSS_CLASSES } from '../src/constants.ts';
import { KanbanView } from '../src/kanbanView.ts';
import { applyLinkFilter, parseLinkFilterConfig, type LinkFilterConfig } from '../src/utils/linkFilter.ts';
import {
	createDivWithMethods,
	createMockApp,
	createMockBasesEntry,
	createMockQueryController,
	createMockTFile,
	setupKanbanViewWithApp,
	setupTestEnvironment,
	triggerDataUpdate,
} from './helpers.ts';

setupTestEnvironment();

interface VaultNote {
	frontmatter?: Record<string, unknown>;
	links?: Array<{ key: string; link: string }>;
}

/**
 * Minimal metadata cache over a path → note map. `getFirstLinkpathDest`
 * resolves a link by basename, the way Obsidian does for unambiguous names.
 */
function createVault(notes: Record<string, VaultNote>): App {
	const byBasename = new Map<string, string>();
	for (const path of Object.keys(notes)) {
		byBasename.set(path.split('/').pop()?.replace(/\.md$/, '') ?? path, path);
	}

	return {
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const note = notes[file.path];
				if (!note) return null;
				return { frontmatter: note.frontmatter, frontmatterLinks: note.links };
			},
			getFirstLinkpathDest: (linkpath: string) => {
				const path = byBasename.get(linkpath);
				return path ? { path } : null;
			},
		},
	} as unknown as App;
}

function entryFor(path: string): BasesEntry {
	return createMockBasesEntry(createMockTFile(path));
}

const FROZEN: LinkFilterConfig = {
	linkProperty: 'Project',
	targetProperty: 'Status',
	values: ['frozen'],
};

describe('parseLinkFilterConfig', () => {
	test('returns null when no link property is configured', () => {
		assert.strictEqual(parseLinkFilterConfig(null, 'Status', ['Frozen'], 'Status'), null);
	});

	test('returns null when the stop-list is empty', () => {
		assert.strictEqual(parseLinkFilterConfig('Project', 'Status', [], 'Status'), null);
		assert.strictEqual(parseLinkFilterConfig('Project', 'Status', undefined, 'Status'), null);
	});

	test('falls back to the group-by property when no target is given', () => {
		const config = parseLinkFilterConfig('Project', '', ['Frozen'], 'Status');
		assert.strictEqual(config?.targetProperty, 'Status');
	});

	test('an explicit target property wins over the fallback', () => {
		const config = parseLinkFilterConfig('Project', 'Phase', ['Frozen'], 'Status');
		assert.strictEqual(config?.targetProperty, 'Phase');
	});

	test('returns null when neither an explicit nor a fallback target exists', () => {
		assert.strictEqual(parseLinkFilterConfig('Project', '  ', ['Frozen'], null), null);
	});

	test('stop-list values are trimmed, lower-cased and de-blanked', () => {
		const config = parseLinkFilterConfig('Project', 'Status', ['  Frozen ', '', 'CANCELED'], 'Status');
		assert.deepStrictEqual(config?.values, ['frozen', 'canceled']);
	});

	test('a bare string stop-list is accepted', () => {
		const config = parseLinkFilterConfig('Project', 'Status', 'Frozen', 'Status');
		assert.deepStrictEqual(config?.values, ['frozen']);
	});
});

describe('applyLinkFilter', () => {
	test('hides a card whose linked note carries a stop-list value', () => {
		const app = createVault({
			'Tasks/research.md': { links: [{ key: 'Project.0', link: 'canton' }] },
			'Projects/canton.md': { frontmatter: { Status: 'Frozen' } },
		});
		const result = applyLinkFilter([entryFor('Tasks/research.md')], FROZEN, app);
		assert.strictEqual(result.entries.length, 0);
		assert.strictEqual(result.hiddenCount, 1);
	});

	test('keeps a card whose linked note is not in the stop-list', () => {
		const app = createVault({
			'Tasks/ship.md': { links: [{ key: 'Project.0', link: 'alliance' }] },
			'Projects/alliance.md': { frontmatter: { Status: 'In Progress' } },
		});
		const result = applyLinkFilter([entryFor('Tasks/ship.md')], FROZEN, app);
		assert.strictEqual(result.entries.length, 1);
		assert.strictEqual(result.hiddenCount, 0);
	});

	test('matching is case-insensitive and whitespace-tolerant', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project', link: 'p' }] },
			'Projects/p.md': { frontmatter: { Status: '  FROZEN ' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).hiddenCount, 1);
	});

	test('a scalar link property (key without index) is matched', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project', link: 'p' }] },
			'Projects/p.md': { frontmatter: { Status: 'Frozen' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).hiddenCount, 1);
	});

	test('a card survives while any of its links is still live', () => {
		const app = createVault({
			'Tasks/a.md': {
				links: [
					{ key: 'Project.0', link: 'frozen-one' },
					{ key: 'Project.1', link: 'live-one' },
				],
			},
			'Projects/frozen-one.md': { frontmatter: { Status: 'Frozen' } },
			'Projects/live-one.md': { frontmatter: { Status: 'In Progress' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).entries.length, 1);
	});

	test('a card is hidden only when every link matches', () => {
		const app = createVault({
			'Tasks/a.md': {
				links: [
					{ key: 'Project.0', link: 'one' },
					{ key: 'Project.1', link: 'two' },
				],
			},
			'Projects/one.md': { frontmatter: { Status: 'Frozen' } },
			'Projects/two.md': { frontmatter: { Status: 'Canceled' } },
		});
		const config: LinkFilterConfig = { ...FROZEN, values: ['frozen', 'canceled'] };
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], config, app).entries.length, 0);
	});

	test('cards with no link property are always kept', () => {
		const app = createVault({ 'Tasks/loose.md': { links: [] } });
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/loose.md')], FROZEN, app).entries.length, 1);
	});

	test('other link properties are ignored', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Areas.0', link: 'building' }] },
			'Areas/building.md': { frontmatter: { Status: 'Frozen' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).entries.length, 1);
	});

	test('a property whose name merely starts with the link property is ignored', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'ProjectLead', link: 'p' }] },
			'Projects/p.md': { frontmatter: { Status: 'Frozen' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).entries.length, 1);
	});

	test('unresolved links keep the card — never drop a card on missing data', () => {
		const app = createVault({ 'Tasks/a.md': { links: [{ key: 'Project.0', link: 'ghost' }] } });
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).entries.length, 1);
	});

	test('a linked note without the target property keeps the card', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project.0', link: 'p' }] },
			'Projects/p.md': { frontmatter: { CreatedAt: '2026-01-01' } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).entries.length, 1);
	});

	test('a list-valued target property matches on any of its values', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project.0', link: 'p' }] },
			'Projects/p.md': { frontmatter: { Status: ['Frozen', 'Review'] } },
		});
		assert.strictEqual(applyLinkFilter([entryFor('Tasks/a.md')], FROZEN, app).hiddenCount, 1);
	});

	test('surviving entries keep their original order', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project.0', link: 'live' }] },
			'Tasks/b.md': { links: [{ key: 'Project.0', link: 'dead' }] },
			'Tasks/c.md': { links: [{ key: 'Project.0', link: 'live' }] },
			'Projects/live.md': { frontmatter: { Status: 'In Progress' } },
			'Projects/dead.md': { frontmatter: { Status: 'Frozen' } },
		});
		const result = applyLinkFilter([entryFor('Tasks/a.md'), entryFor('Tasks/b.md'), entryFor('Tasks/c.md')], FROZEN, app);
		assert.deepStrictEqual(
			result.entries.map((e) => e.file.path),
			['Tasks/a.md', 'Tasks/c.md'],
		);
	});

	test('every resolved linked note is reported as a source to watch', () => {
		const app = createVault({
			'Tasks/a.md': { links: [{ key: 'Project.0', link: 'live' }] },
			'Tasks/b.md': { links: [{ key: 'Project.0', link: 'dead' }] },
			'Projects/live.md': { frontmatter: { Status: 'In Progress' } },
			'Projects/dead.md': { frontmatter: { Status: 'Frozen' } },
		});
		const result = applyLinkFilter([entryFor('Tasks/a.md'), entryFor('Tasks/b.md')], FROZEN, app);
		assert.deepStrictEqual([...result.sources].sort(), ['Projects/dead.md', 'Projects/live.md']);
	});

	test('without an app the list passes through untouched', () => {
		const entries = [entryFor('Tasks/a.md')];
		const result = applyLinkFilter(entries, FROZEN, undefined);
		assert.strictEqual(result.entries, entries);
		assert.strictEqual(result.hiddenCount, 0);
	});
});

const PROPERTY_STATUS = 'note.Status' as BasesPropertyId;
const PROPERTY_PROJECT = 'note.Project' as BasesPropertyId;

/**
 * Three tasks in one column; the middle one hangs off a frozen project. Mirrors
 * the shape the filter exists for: a self-similar schema where a task and its
 * project both carry `Status`.
 */
function createFilterView(options: { values?: string[]; targetProperty?: string } = {}): {
	view: KanbanView;
	controller: any;
} {
	const scrollEl = createDivWithMethods();
	const entries = [
		createMockBasesEntry(createMockTFile('Tasks/live.md'), { [PROPERTY_STATUS]: 'In Progress' }),
		createMockBasesEntry(createMockTFile('Tasks/frozen.md'), { [PROPERTY_STATUS]: 'In Progress' }),
		createMockBasesEntry(createMockTFile('Tasks/loose.md'), { [PROPERTY_STATUS]: 'In Progress' }),
	];
	const controller: any = createMockQueryController(entries, [PROPERTY_STATUS, PROPERTY_PROJECT]);

	const vault = createVault({
		'Tasks/live.md': { links: [{ key: 'Project.0', link: 'alliance' }] },
		'Tasks/frozen.md': { links: [{ key: 'Project.0', link: 'canton' }] },
		'Tasks/loose.md': { links: [] },
		'Projects/alliance.md': { frontmatter: { Status: 'In Progress' } },
		'Projects/canton.md': { frontmatter: { Status: 'Frozen' } },
	});
	const app = Object.assign(createMockApp(), { metadataCache: vault.metadataCache });
	(app.metadataCache as any).on = () => ({ detach: (): void => undefined });
	controller.app = app;

	controller.config.getAsPropertyId = (key: string) => {
		if (key === 'groupByProperty') return PROPERTY_STATUS;
		if (key === 'linkFilterProperty') return PROPERTY_PROJECT;
		return null;
	};
	controller.config.set('linkFilterValues', options.values ?? ['Frozen']);
	if (options.targetProperty) controller.config.set('linkFilterTargetProperty', options.targetProperty);

	const view = new KanbanView(controller, scrollEl);
	setupKanbanViewWithApp(view, app);
	return { view, controller };
}

function cardPaths(view: KanbanView): string[] {
	return [...view.containerEl.querySelectorAll(`.${CSS_CLASSES.CARD}`)].map(
		(el) => el.getAttribute('data-entry-path') ?? '',
	);
}

describe('KanbanView - linked note filter', () => {
	test('cards whose linked note is filtered out never reach the board', () => {
		const { view } = createFilterView();
		triggerDataUpdate(view);
		assert.deepStrictEqual(cardPaths(view), ['Tasks/live.md', 'Tasks/loose.md']);
	});

	test('the column count reflects the filtered list', () => {
		const { view } = createFilterView();
		triggerDataUpdate(view);
		const count = view.containerEl.querySelector(`.${CSS_CLASSES.COLUMN_COUNT}`);
		assert.strictEqual(count?.textContent, '2');
	});

	test('the target property defaults to the group-by property', () => {
		// No linkFilterTargetProperty is set, yet `Status` on the project is read.
		const { view } = createFilterView();
		triggerDataUpdate(view);
		assert.ok(!cardPaths(view).includes('Tasks/frozen.md'));
	});

	test('an explicit target property overrides the default', () => {
		const { view } = createFilterView({ targetProperty: 'Phase' });
		triggerDataUpdate(view);
		// Projects carry no `Phase`, so nothing matches and every card stays.
		assert.strictEqual(cardPaths(view).length, 3);
	});

	test('no configured values leaves the board unfiltered', () => {
		const { view } = createFilterView({ values: [] });
		triggerDataUpdate(view);
		assert.strictEqual(cardPaths(view).length, 3);
		assert.strictEqual(view.containerEl.querySelector(`.${CSS_CLASSES.LINK_FILTER_BAR}`), null);
	});

	test('the bar reports how many cards are withheld', () => {
		const { view } = createFilterView();
		triggerDataUpdate(view);
		const bar = view.containerEl.querySelector(`.${CSS_CLASSES.LINK_FILTER_BAR}`);
		assert.ok(bar, 'Expected the filter bar to render');
		assert.match(bar.textContent ?? '', /1 card hidden by linked note/);
	});

	test('the bar chip reveals the filtered cards, and hides them again', () => {
		const { view } = createFilterView();
		triggerDataUpdate(view);

		const chip = view.containerEl.querySelector<HTMLElement>(`.${CSS_CLASSES.LINK_FILTER_CHIP}`);
		assert.ok(chip, 'Expected a reveal chip');
		chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.strictEqual(cardPaths(view).length, 3, 'Revealed board should show every card');

		const chipAgain = view.containerEl.querySelector<HTMLElement>(`.${CSS_CLASSES.LINK_FILTER_CHIP}`);
		assert.ok(chipAgain);
		chipAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.strictEqual(cardPaths(view).length, 2, 'Filter should re-apply');
	});

	test('no bar is rendered while the filter withholds nothing', () => {
		const { view } = createFilterView({ values: ['Nothing Matches This'] });
		triggerDataUpdate(view);
		assert.strictEqual(view.containerEl.querySelector(`.${CSS_CLASSES.LINK_FILTER_BAR}`), null);
	});
});
