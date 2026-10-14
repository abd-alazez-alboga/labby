import { Outlet } from 'react-router-dom';

import { NotificationsProvider } from '../notifications/NotificationsProvider';
import { PushProvider } from '../push/PushProvider';
import { SosAlertsProvider } from '../sos/SosAlertsProvider';
import { Navbar } from './Navbar';
import { Sidenav } from './Sidenav';

/**
 * Shell chrome: white sidebar + top bar around the routed page. The signed-in
 * shell also owns the notification-center facade (unread badge polling),
 * browser-push registration, and the open-SOS facade (nav badge + sticky
 * critical alerts, M10), so all three live exactly as long as a session.
 */
export function AppLayout() {
  return (
    <NotificationsProvider>
      <PushProvider>
        <SosAlertsProvider>
          <div className="app-shell">
            <Sidenav />
            <div className="app-main">
              <Navbar />
              <main className="app-content">
                <Outlet />
              </main>
            </div>
          </div>
        </SosAlertsProvider>
      </PushProvider>
    </NotificationsProvider>
  );
}
