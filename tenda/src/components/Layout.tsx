import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Bell, User, CheckSquare } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Link, useLocation } from "@/router";
import { ThemeToggle } from './ThemeToggle';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Tasks', href: '/tasks' },
    { name: 'Processes', href: '/processes' },
    { name: 'Dashboard', href: '/dashboard' },
  ];

  const isActive = (href: string) => location.pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card/60 backdrop-blur-xl">
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center">
            <Link to="/tasks" className="flex items-center space-x-2 group">
              <CheckSquare className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
              <span className="text-2xl font-bold text-foreground tracking-tight">Tenda</span>
            </Link>
          </div>

          <div className="flex-1 flex justify-center">
            <nav className="hidden md:flex space-x-8">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`text-sm font-medium transition-all hover:text-primary relative py-1 ${isActive(item.href)
                    ? 'text-primary drop-shadow-[0_0_8px_rgba(22,163,74,0.5)]'
                    : 'text-muted-foreground'
                    }`}
                >
                  {item.name}
                  {isActive(item.href) && (
                    <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-primary rounded-full shadow-[0_0_10px_rgba(22,163,74,0.8)]" />
                  )}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {user?.username?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuItem className="flex items-center">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                {logout && (
                  <DropdownMenuItem onClick={logout}>
                    <span>Log out</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
