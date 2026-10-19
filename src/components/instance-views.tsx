import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, CircleCheck, Copy, RotateCw } from "lucide-react";
import type { Row } from "@/instance-selection";
import type { Activity, ConsoleController } from "@/hooks/use-console";
import type { OperationAction } from "@/operations";
import {
  actionLabels,
  dateLabel,
  regionLabel,
  stateLabel,
} from "@/lib/display";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant={state === "running" ? "secondary" : "outline"}>
      {["pending", "stopping"].includes(state) && <Spinner />}
      {stateLabel(state)}
    </Badge>
  );
}

function CopyButton({
  value,
  label = "复制 IP",
}: {
  value?: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 1800);
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={!value}
      aria-label={status === "failed" ? "复制失败" : label}
      onClick={() => void copy()}
    >
      {status === "copied" ? (
        <Check />
      ) : status === "failed" ? (
        <CircleAlert />
      ) : (
        <Copy />
      )}
    </Button>
  );
}

export function OperationFeedback({
  controller: c,
}: {
  controller: ConsoleController;
}) {
  return (
    <div className="flex flex-col gap-2 empty:hidden" aria-live="polite">
      {c.job && (
        <Alert>
          <Spinner />
          <AlertTitle>{c.job.message}</AlertTitle>
        </Alert>
      )}
      {c.instance && c.error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{c.error}</AlertTitle>
        </Alert>
      )}
      {c.notice && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{c.notice}</AlertTitle>
        </Alert>
      )}
      {c.result && (
        <Alert>
          <CircleCheck />
          <AlertTitle>{c.result}</AlertTitle>
        </Alert>
      )}
    </div>
  );
}

function ConfirmAction({
  action,
  controller: c,
  children,
  variant = "outline",
  disabled,
}: {
  action: OperationAction;
  controller: ConsoleController;
  children: ReactNode;
  variant?: "outline" | "default" | "destructive";
  disabled: boolean;
}) {
  const stop = action === "stop";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} className="min-w-20" disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogTitle>
          {stop ? "确认停止实例？" : "确认更换公网 IP？"}
        </AlertDialogTitle>
        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={stop ? "destructive" : "default"}
            onClick={() => void c.operate(action)}
          >
            确认{actionLabels[action]}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Controls({ controller: c }: { controller: ConsoleController }) {
  const row = c.instance!;
  const disabled = c.loading || !!c.job || !!c.error;
  const running = row.state.name === "running";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmAction
        action="rotate-ip"
        controller={c}
        variant="default"
        disabled={disabled || !running || !!row.isStaticIp}
      >
        更换 IP
      </ConfirmAction>
      {row.state.name === "stopped" ? (
        <Button
          className="min-w-20"
          disabled={disabled}
          onClick={() => void c.operate("start")}
        >
          开机
        </Button>
      ) : (
        <ConfirmAction
          action="stop"
          controller={c}
          disabled={disabled || !running}
        >
          关机
        </ConfirmAction>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  wide,
}: {
  label: string;
  value?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 sm:col-span-1")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-words whitespace-pre-wrap">
        {value ?? "—"}
      </dd>
    </div>
  );
}

function ServerDetails({ row }: { row: Row }) {
  const disks = row.hardware?.disks;
  const total =
    disks?.length && disks.every((disk) => disk.sizeInGb !== undefined)
      ? disks.reduce((sum, disk) => sum + (disk.sizeInGb ?? 0), 0)
      : undefined;
  const value = (number: number | undefined, unit: string) =>
    number === undefined ? undefined : `${number} ${unit}`;
  const ssh =
    row.username && row.publicIpAddress
      ? `ssh ${row.username}@${row.publicIpAddress}`
      : undefined;
  const details: [string, ReactNode, boolean?][] = [
    ["处理器", value(row.hardware?.cpuCount, "vCPU")],
    ["内存", value(row.hardware?.ramSizeInGb, "GB")],
    ["存储", value(total, "GB")],
    ["系统", row.blueprintName],
    ["套餐", row.bundleId],
    ["可用区", row.location?.availabilityZone],
    ["私网 IPv4", row.privateIpAddress],
    [
      "IPv6",
      row.ipv6Addresses?.length ? (
        <span className="font-mono text-xs">
          {row.ipv6Addresses.join("\n")}
        </span>
      ) : undefined,
      true,
    ],
    [
      "地址类型",
      row.isStaticIp === undefined
        ? undefined
        : row.isStaticIp
          ? "静态 IP"
          : "动态 IP",
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>服务器</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          {details.map(([label, content, wide]) => (
            <Info key={label} label={label} value={content} wide={wide} />
          ))}
        </dl>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
            {ssh ?? "—"}
          </code>
          <CopyButton value={ssh} label="复制 SSH 命令" />
        </div>
      </CardContent>
    </Card>
  );
}

function History({ history }: { history: Activity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>操作记录</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {history.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>操作</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>地址变化</TableHead>
                <TableHead className="text-right">时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {actionLabels[entry.action]}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1.5">
                      <Badge
                        variant={entry.failed ? "destructive" : "secondary"}
                      >
                        {entry.failed ? "失败" : "完成"}
                      </Badge>
                      <span className="max-w-64 text-xs whitespace-normal text-muted-foreground">
                        {entry.message}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {entry.newIp ? (
                      <span className="font-mono text-xs">
                        {entry.oldIp ?? "—"} → {entry.newIp}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                    {dateLabel(entry.time)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            暂无操作记录
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function InstanceView({
  controller: c,
}: {
  controller: ConsoleController;
}) {
  const row = c.instance!;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {row.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {regionLabel(row.region)} · {row.region}
          </p>
        </div>
        <StateBadge state={row.state.name} />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">公网 IPv4</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-3xl font-semibold tracking-tight tabular-nums break-all sm:text-4xl">
                {row.publicIpAddress ?? "—"}
              </span>
              <CopyButton value={row.publicIpAddress} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Controls controller={c} />
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新状态"
              disabled={c.loading || !!c.job}
              onClick={() => void c.refresh()}
            >
              {c.loading ? <Spinner /> : <RotateCw />}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ServerDetails row={row} />
      <History history={c.history} />
    </>
  );
}

export function NoInstance({
  error,
  refresh,
  loading,
}: {
  error: string;
  refresh: () => Promise<void>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          {error.includes("没有找到实例") ? "没有可控制的实例" : error}
        </p>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading && <Spinner data-icon="inline-start" />}
          重试
        </Button>
      </CardContent>
    </Card>
  );
}
