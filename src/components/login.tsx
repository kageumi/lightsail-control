import { useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import type { ConsoleController } from "@/hooks/use-console";
import { TopBar } from "./console-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export function Login({ controller }: { controller: ConsoleController }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setInvalid(true);
    setInvalid(false);
    void controller.login(password);
  }

  return (
    <div className="flex min-h-svh flex-col">
      <TopBar />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-xs">
          <CardContent className="flex flex-col gap-5">
            <h1 className="text-lg font-semibold tracking-tight">登录</h1>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="password" className="text-sm font-medium">
                  管理密码
                </label>
                <InputGroup>
                  <InputGroupInput
                    id="password"
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setInvalid(false);
                    }}
                    autoComplete="current-password"
                    autoFocus
                    disabled={controller.loading}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? "password-error" : undefined}
                  />
                  <InputGroupAddon>
                    <InputGroupButton
                      aria-label={visible ? "隐藏密码" : "显示密码"}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {invalid && (
                  <p
                    id="password-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    密码至少 8 位
                  </p>
                )}
              </div>
              {controller.notice && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{controller.notice}</AlertTitle>
                </Alert>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={controller.loading}
              >
                {controller.loading && <Spinner data-icon="inline-start" />}
                {controller.loading ? "正在登录" : "进入控制台"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
