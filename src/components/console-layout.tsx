import { LogOut, Moon, Server, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import type { ReactNode } from "react";
import type { ConsoleController } from "@/hooks/use-console";
import { Button } from "@/components/ui/button";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Server className="size-4" aria-hidden="true" />
      </span>
      <span className="text-lg font-semibold tracking-tight">
        Lightsail<span className="text-primary">.</span>
      </span>
    </div>
  );
}
export function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="切换明暗主题"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
export function ConsoleLayout({
  controller,
  children,
}: {
  controller: ConsoleController;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeButton />
            <Button
              variant="ghost"
              size="icon"
              aria-label="退出登录"
              disabled={controller.loading || !!controller.job}
              onClick={() => void controller.logout()}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10"
      >
        <div className="flex flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
