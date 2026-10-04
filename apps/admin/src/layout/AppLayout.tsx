import { Outlet } from 'react-router-dom';

import { Navbar } from './Navbar';
import { Sidenav } from './Sidenav';

/** Shell chrome: sidenav + top navbar around the routed page. */
export function AppLayout() {
  return (
    <div className="app-shell">
      <Sidenav />
      <div className="app-main">
        <Navbar />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
