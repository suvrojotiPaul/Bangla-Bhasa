import { h } from '../dom.js';
import { icon } from '../icons.js';

const TABS = [
  { path: '/home', label: 'Learn', icon: 'home' },
  { path: '/review', label: 'Review', icon: 'review' },
  { path: '/words', label: 'Words', icon: 'book' },
  { path: '/settings', label: 'Settings', icon: 'sliders' },
];

export function tabbar(currentPath) {
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    TABS.map((tab) =>
      h(
        'a',
        { class: 'tabbar__link', href: `#${tab.path}`, 'aria-current': tab.path === currentPath ? 'page' : null },
        icon(tab.icon),
        tab.label,
      ),
    ),
  );
}
