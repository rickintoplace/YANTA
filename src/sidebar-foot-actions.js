import { lucide } from './core.js';

const DEFAULT_ICON_SIZE = 20;

export function createSidebarFootActions({
  openPalette,
  openGraph,
  openCalendar,
  openSources,
  openAssistant,
  openMore,
} = {}) {
  return [
    {
      id: 'btn-palette',
      key: 'palette',
      icon: 'keyboard',
      label: 'Command palette',
      title: 'Command palette (Ctrl+P)',
      onClick: () => openPalette?.('commands'),
    },
    {
      id: 'btn-graph',
      key: 'graph',
      icon: 'network',
      label: 'Graph view',
      title: 'Graph view (Ctrl+G)',
      onClick: () => openGraph?.(),
    },
    {
      id: 'btn-calendar',
      key: 'calendar',
      icon: 'calendar-days',
      label: 'Calendar',
      title: 'Calendar',
      onClick: () => openCalendar?.(),
    },
    {
      id: 'btn-sources',
      key: 'sources',
      icon: 'rss',
      label: 'Sources',
      title: 'Sources (RSS)',
      onClick: () => openSources?.(),
    },
    {
      id: 'btn-ai',
      key: 'ai',
      icon: 'bot',
      label: 'YANTA AI',
      title: 'YANTA AI',
      onClick: () => openAssistant?.(),
    },
    {
      id: 'btn-sidebar-menu',
      key: 'more',
      icon: 'ellipsis-vertical',
      iconSize: 20,
      label: 'More options',
      title: 'More options',
      wrapperClass: 'sidebar-foot-menu-wrapper',
      closeMobile: false,
      onClick: (event) => openMore?.(event.currentTarget),
    },
  ];
}

export function renderSidebarFootActions(
  container,
  actions,
  {
    afterAction,
  } = {}
) {
  if (!container) return;

  const fragment = document.createDocumentFragment();

  for (const action of actions || []) {
    if (!action) continue;

    const button = document.createElement('button');

    button.type = 'button';
    button.className = `icon-btn${action.className ? ` ${action.className}` : ''}`;

    if (action.id) {
      button.id = action.id;
    }

    button.dataset.sidebarFootAction = action.key || action.id || action.icon || '';

    button.title = action.title || action.label || '';
    button.setAttribute('aria-label', action.ariaLabel || action.label || action.title || '');

    button.innerHTML = lucide(
      action.icon || 'circle',
      action.iconSize || DEFAULT_ICON_SIZE
    );

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        await action.onClick?.(event);

        if (action.closeMobile !== false) {
          afterAction?.(action, event);
        }
      } catch (err) {
        console.error('[YANTA] Sidebar foot action failed:', action.key || action.id, err);
      }
    });

    if (action.wrapperClass) {
      const wrapper = document.createElement('div');
      wrapper.className = action.wrapperClass;
      wrapper.append(button);
      fragment.append(wrapper);
    } else {
      fragment.append(button);
    }

    if (action.key === 'more') {
    button.setAttribute('aria-haspopup', 'menu');
    }
  }

  container.replaceChildren(fragment);
}

function findRenderedFooterAction(container, action) {
  const key = action?.key || action?.id;

  if (!container || !key) return null;

  for (const el of container.querySelectorAll('[data-sidebar-foot-action]')) {
    if (el.dataset.sidebarFootAction === key) {
      return el;
    }
  }

  return null;
}

function isActuallyVisible(el, within) {
  if (!el || !within || !el.isConnected) return false;
  if (el.hidden || el.closest('[hidden]')) return false;

  let node = el;

  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }

    if (node === within) break;

    node = node.parentElement;
  }

  const rect = el.getBoundingClientRect();

  if (rect.width < 2 || rect.height < 2) {
    return false;
  }

  const containerRect = within.getBoundingClientRect();

  return (
    rect.right > containerRect.left + 1 &&
    rect.left < containerRect.right - 1 &&
    rect.bottom > containerRect.top + 1 &&
    rect.top < containerRect.bottom - 1
  );
}

function isActionVisibleInFooter(container, action) {
  const el = findRenderedFooterAction(container, action);

  return isActuallyVisible(el, container);
}

function menuItemFromSidebarFootAction(action, {
  afterAction,
} = {}) {
  return {
    label: action.menuLabel || action.label || action.title || 'Action',
    action: async () => {
      await action.onClick?.();

      if (action.closeMobile !== false) {
        afterAction?.(action);
      }
    },
  };
}

export function createSidebarFootOverflowMenuItems({
  container,
  actions = [],
  menuOnlyActions = [],
  afterAction,
} = {}) {
  const hiddenFooterActions = actions
    .filter(Boolean)
    .filter((action) => action.key !== 'more')
    .filter((action) => !isActionVisibleInFooter(container, action))
    .map((action) =>
      menuItemFromSidebarFootAction(action, {
        afterAction,
      })
    );

  const staticMenuActions = menuOnlyActions
    .filter(Boolean)
    .map((action) =>
      menuItemFromSidebarFootAction(action, {
        afterAction,
      })
    );

  if (hiddenFooterActions.length && staticMenuActions.length) {
    return [
      ...hiddenFooterActions,
      'hr',
      ...staticMenuActions,
    ];
  }

  return [
    ...hiddenFooterActions,
    ...staticMenuActions,
  ];
}