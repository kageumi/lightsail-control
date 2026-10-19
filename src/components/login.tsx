import { useState, type FormEvent } from "react";
import { Eye, EyeOff, CircleAlert } from "lucide-react";
import type { ConsoleController } from "@/hooks/use-console";
import { Brand, ThemeButton } from "./console-layout";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export function Login({ controller }: { controller: ConsoleController }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void controller.login(password);
  }
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <ThemeButton />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <h1>登录</h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field
                  data-invalid={invalid || undefined}
                  data-disabled={controller.loading || undefined}
                >
                  <FieldLabel htmlFor="password">管理密码</FieldLabel>
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
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        size="icon-sm"
                        aria-label={visible ? "隐藏密码" : "显示密码"}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {invalid && (
                    <FieldError id="password-error">密码至少 8 位</FieldError>
                  )}
                </Field>
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
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
