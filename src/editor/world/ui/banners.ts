/** Message strips above the canvas: read-only mode (with password box) and load notices. */
import { toast } from '../../common/nav';
import { setEditorToken } from '../../../shared/api';
import type { Actions } from '../actions';
import type { Editor } from '../state/editor';
import { refreshWritable } from '../state/persistence';
import { h, throttled } from './dom';
import { infoDialog } from './dialogs';

export function buildBanners(editor: Editor, actions: Actions): { el: HTMLElement; showNotices(notices: string[]): void } {
  /* ---- read-only ---- */
  const password = h('input', { type: 'password', placeholder: 'Editor password', 'aria-label': 'Editor password', autocomplete: 'current-password' });
  const unlock = async (): Promise<void> => {
    if (!password.value) return;
    setEditorToken(password.value);
    if (await refreshWritable(editor)) {
      password.value = '';
      toast('Unlocked - you can save now');
    } else {
      toast('That password did not work', 2500);
    }
  };
  password.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') void unlock();
  });
  const readOnly = h('div', { class: 'banner readonly', role: 'status' },
    h('strong', {}, 'Read-only'),
    h('span', {}, 'This server needs the editor password before it will save. You can still build - use Export to keep your work.'),
    password,
    h('button', { type: 'button', class: 'primary', onclick: () => void unlock() }, 'Unlock'),
    h('button', { type: 'button', onclick: () => actions.exportJson() }, 'Export JSON'),
    h('button', { type: 'button', onclick: () => actions.importJson() }, 'Import JSON'),
  );

  /* ---- notices from loading ---- */
  let current: string[] = [];
  const noticeText = h('span', {});
  const notice = h('div', { class: 'banner notice', role: 'status', hidden: true },
    noticeText,
    h('button', { type: 'button', onclick: () => void infoDialog('What was fixed while loading', 'Nothing has been changed on disk. These fixes are saved the next time you save the room.', current) }, 'Details'),
    h('button', { type: 'button', 'aria-label': 'Dismiss', onclick: () => { notice.hidden = true; } }, '✕'),
  );

  const el = h('div', { class: 'banners' }, readOnly, notice);
  const sync = (): void => { readOnly.hidden = editor.writable; };
  editor.events.on('ui', throttled(sync));
  sync();

  return {
    el,
    showNotices(notices) {
      current = notices;
      notice.hidden = notices.length === 0;
      noticeText.textContent = notices.length === 1 ? notices[0] : `${notices.length} notes from loading the world (some content was missing or repaired).`;
    },
  };
}
