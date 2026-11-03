import { h } from '../dom.js';

const TABS = [
  { path: '/review', label: 'Practice' },
  { path: '/review/verbs', label: 'Verbs' },
];

/** Practice | Verbs at the top of the Review tab. */
export function reviewSwitch(currentPath) {
  return h(
    'nav',
    { class: 'review-switch', 'aria-label': 'Review' },
    TABS.map((tab) =>
      h('a', { class: 'review-switch__tab', href: `#${tab.path}`, 'aria-current': tab.path === currentPath ? 'page' : null }, tab.label),
    ),
  );
}
