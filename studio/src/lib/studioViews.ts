/** The Studio's top-level views and how they map to the header tabs. */

/** Left-to-right order of the views; a nested view sits just after its tab. */
const ORDER: Record<StudioView, number> = {
  designer: 0, inbox: 1, operations: 2, instance: 2.5, insight: 3, administration: 4,
};

/** Which side a view arrives from when switching from `from` to `to`. */
export function switchDirection(from: StudioView, to: StudioView): -1 | 0 | 1 {
  return ORDER[to] === ORDER[from] ? 0 : ORDER[to] > ORDER[from] ? 1 : -1;
}

/** Every view the Studio can show, including the ones nested under a tab. */
export type StudioView = 'designer' | 'inbox' | 'operations' | 'instance' | 'administration' | 'insight';
/** The views that have their own tab in the header. */
export type NavTab = 'designer' | 'inbox' | 'operations' | 'insight' | 'administration';

/**
 * The tab a view belongs to. Views reached from inside a tab (an instance's
 * detail page) keep their parent tab highlighted, wherever they were opened from.
 */
export function navTabFor(view: StudioView): NavTab {
  return view === 'instance' ? 'operations' : view;
}
