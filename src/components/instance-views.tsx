import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  Copy,
  History,
  Play,
  Power,
  Repeat2,
  RotateCw,
  Server,
} from "lucide-react";
import type { Row } from "@/instance-selection";
import type { ConsoleController, Activity } from "@/hooks/use-console";
import type { OperationAction } from "@/operations";
import {
  actionLabels,
  regionLabel,
  stateLabel,
  dateLabel,
} from "@/lib/display";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function StateBadge({ row }: { row: Row }) {
  const running = row.state.name === "running";
  return (
    <Badge variant={running ? "secondary" : "outline"}>
      {["pending", "stopping"].includes(row.state.name) ? (
        <Spinner />
      ) : running ? (
        <CircleCheck />
      ) : (
        <Circle />
      )}
      {stateLabel(row.state.name)}
    </Badge>
  );
}
export function CopyButton({
  value,
  label = "复制 IP",
}: {
  value?: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
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
  if (!c.job && !(c.instance && c.error) && !c.notice && !c.result) return null;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
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
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} className="min-w-24" disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === "stop" ? "确认停止实例？" : "确认更换公网 IP？"}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={action === "stop" ? "destructive" : "default"}
            onClick={() => void c.operate(action)}
          >
            确认{actionLabels[action]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Controls({ controller: c }: { controller: ConsoleController }) {
  const row = c.instance!;
  const disabled = c.loading || !!c.job || !!c.error;
  const running = row.state.name === "running";
  const stopped = row.state.name === "stopped";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmAction
        action="rotate-ip"
        controller={c}
        variant="default"
        disabled={disabled || !running || !!row.isStaticIp}
      >
        <Repeat2 data-icon="inline-start" />
        更换 IP
      </ConfirmAction>
      {stopped ? (
        <Button
          className="min-w-24"
          disabled={disabled}
          onClick={() => void c.operate("start")}
        >
          <Play data-icon="inline-start" />
          开机
        </Button>
      ) : (
        <ConfirmAction
          action="stop"
          controller={c}
          disabled={disabled || !running}
        >
          <Power data-icon="inline-start" />
          关机
        </ConfirmAction>
      )}
    </div>
  );
}
export function InstancePanel({
  controller: c,
}: {
  controller: ConsoleController;
}) {
  const row = c.instance!;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {row.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {regionLabel(row.region)} · {row.region}
          </p>
        </div>
        <div className="shrink-0">
          <StateBadge row={row} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>公网 IPv4</h2>
          </CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              disabled={c.loading || !!c.job}
              onClick={() => void c.refresh()}
            >
              {c.loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCw data-icon="inline-start" />
              )}
              刷新状态
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular-nums break-all sm:text-4xl">
              {row.publicIpAddress ?? "—"}
            </span>
            <CopyButton value={row.publicIpAddress} />
          </div>
          <Controls controller={c} />
        </CardContent>
      </Card>
    </div>
  );
}
function DefinitionList({ items }: { items: [string, ReactNode, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      {items.map(([label, value, className]) => (
        <div key={label} className={cn("min-w-0", className)}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-sm font-medium whitespace-pre-wrap break-words">
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ServerDetails({
  controller: c,
}: {
  controller: ConsoleController;
}) {
  const row = c.instance!;
  const disks = row.hardware?.disks;
  const total =
    disks?.length && disks.every((d) => d.sizeInGb !== undefined)
      ? disks.reduce((sum, d) => sum + (d.sizeInGb ?? 0), 0)
      : undefined;
  const ssh =
    row.username && row.publicIpAddress
      ? `ssh ${row.username}@${row.publicIpAddress}`
      : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="server-title">服务器</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <DefinitionList
          items={[
            [
              "处理器",
              row.hardware?.cpuCount === undefined
                ? undefined
                : `${row.hardware.cpuCount} vCPU`,
            ],
            [
              "内存",
              row.hardware?.ramSizeInGb === undefined
                ? undefined
                : `${row.hardware.ramSizeInGb} GB`,
            ],
            ["存储", total === undefined ? undefined : `${total} GB`],
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
              "col-span-2 sm:col-span-1",
            ],
            [
              "地址类型",
              row.isStaticIp === undefined
                ? undefined
                : row.isStaticIp
                  ? "静态 IP"
                  : "动态 IP",
            ],
          ]}
        />
        {disks && disks.length > 1 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {disks.map((disk, i) => (
              <p key={i}>
                磁盘 {i + 1} ·{" "}
                {disk.isSystemDisk === undefined
                  ? "—"
                  : disk.isSystemDisk
                    ? "系统盘"
                    : "数据盘"}{" "}
                · {disk.sizeInGb === undefined ? "—" : `${disk.sizeInGb} GB`}
              </p>
            ))}
          </div>
        )}
        <Separator />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium">SSH</h3>
            <CopyButton value={ssh} label="复制 SSH 命令" />
          </div>
          <code className="block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
            {ssh ?? "—"}
          </code>
        </div>
      </CardContent>
    </Card>
  );
}
export function HistoryView({ history }: { history: Activity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="history-title">操作记录</h2>
        </CardTitle>
        {history.length > 0 && (
          <CardAction>
            <Badge variant="outline">{history.length}</Badge>
          </CardAction>
        )}
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
                      <span className="max-w-72 text-xs whitespace-normal text-muted-foreground">
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
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyTitle>暂无操作记录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
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
  const empty = error.includes("没有找到实例");
  return (
    <Card>
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {empty ? <Server /> : <CircleAlert />}
          </EmptyMedia>
          <EmptyTitle>{empty ? "没有可控制的实例" : error}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCw data-icon="inline-start" />
            )}
            重试
          </Button>
        </EmptyContent>
      </Empty>
    </Card>
  );
}
