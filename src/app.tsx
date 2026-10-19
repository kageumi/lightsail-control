import { useConsole } from "@/hooks/use-console";
import { ConsoleLayout } from "@/components/console-layout";
import { Login } from "@/components/login";
import {
  HistoryView,
  InstancePanel,
  NoInstance,
  OperationFeedback,
  ServerDetails,
} from "@/components/instance-views";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export default function App() {
  const controller = useConsole();
  if (controller.checking)
    return (
      <div className="flex min-h-svh items-center justify-center" role="status">
        <Spinner />
        <span className="sr-only">加载中</span>
      </div>
    );
  if (!controller.authenticated) return <Login controller={controller} />;
  const row = controller.instance;
  return (
    <ConsoleLayout controller={controller}>
      <OperationFeedback controller={controller} />
      {controller.loading && !row ? (
        <div
          className="flex flex-col gap-6"
          aria-label="正在读取实例"
          role="status"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      ) : !row ? (
        <NoInstance
          error={controller.error || "没有找到实例"}
          refresh={controller.refresh}
          loading={controller.loading}
        />
      ) : (
        <>
          <InstancePanel controller={controller} />
          <ServerDetails controller={controller} />
          <HistoryView history={controller.history} />
        </>
      )}
    </ConsoleLayout>
  );
}
