/** Full-screen notice after automatic browser-session renewal still returns 401. */
import { useT } from '../i18n/store.js';

export function RelaunchNotice() {
  const t = useT();
  return (
    <main class="relaunch-notice">
      <h1>{t('notice.relaunch.title')}</h1>
      <p>{t('notice.relaunch.body')}</p>
      <p>
        {t('notice.relaunch.relaunch_pre')}<code>rasen ui</code>{t('notice.relaunch.relaunch_post')}
      </p>
    </main>
  );
}
