import { NavLink, Outlet } from "react-router";

const TABS = [
  { to: "/", label: "Recherches", icon: "🔎", end: true },
  { to: "/alertes", label: "Alertes", icon: "🔔", end: false },
  { to: "/suivi", label: "Suivi", icon: "⭐", end: false },
  { to: "/reglages", label: "Réglages", icon: "⚙️", end: false },
];

export function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <img src="/icon.svg" alt="" width={24} height={24} />
            Alerteur eBay
          </span>
          <nav className="topnav" aria-label="Navigation principale">
            {TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navigation">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}>
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
