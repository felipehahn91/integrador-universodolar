import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { PanelLeft, Settings, LayoutDashboard, LogOut, Users, Contact } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MadeWithDyad } from "./made-with-dyad";

const Layout = () => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const navItems = [
    { to: "/", icon: <LayoutDashboard className="h-5 w-5" />, label: "Dashboard" },
    { to: "/contacts", icon: <Contact className="h-5 w-5" />, label: "Contatos" },
    { to: "/users", icon: <Users className="h-5 w-5" />, label: "Usuários" },
    { to: "/settings", icon: <Settings className="h-5 w-5" />, label: "Configurações" },
  ];

  const sidebarNav = (
    <nav className="flex flex-col items-start gap-2 px-4 py-4">
      <div className="px-2 pb-4">
        <img src="/logo.webp" alt="Universo do Lar Logo" className="h-10" />
      </div>
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${isActive ? "bg-muted text-primary font-semibold" : ""}`
          }
          end={item.to === "/"}
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const mobileNav = (
    <nav className="grid gap-6 text-lg font-medium">
      <div className="px-2.5 py-4">
        <img src="/logo.webp" alt="Universo do Lar Logo" className="h-10" />
      </div>
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground ${isActive ? "text-foreground font-semibold" : ""}`
          }
          end={item.to === "/"}
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
      <Button variant="ghost" className="w-full justify-start gap-4 px-2.5" onClick={handleSignOut}>
        <LogOut className="h-5 w-5" />
        Sair
      </Button>
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r bg-background sm:flex">
        {sidebarNav}
        <div className="mt-auto p-4">
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={handleSignOut}>
            <LogOut className="h-5 w-5" />
            Sair
          </Button>
        </div>
      </aside>
      <div className="flex flex-col sm:gap-4 sm:py-4 sm:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="outline" className="sm:hidden">
                <PanelLeft className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="sm:max-w-xs">
              {mobileNav}
            </SheetContent>
          </Sheet>
        </header>
        <main className="flex-1 p-4 sm:px-6 sm:py-0">
          <Outlet />
        </main>
        <div className="sm:pl-64">
          <MadeWithDyad />
        </div>
      </div>
    </div>
  );
};

export default Layout;