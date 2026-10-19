import { useConsole } from "@/hooks/use-console";
import { ConsoleLayout } from "@/components/console-layout";
import { Login } from "@/components/login";
import {
  InstanceView,
  NoInstance,
  OperationFeedback,
} from "@/components/instance-views";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export default function App() {
  const c = useConsole();
  if (c.checking)
    return (
      <div className="flex min-h-svh items-center justify-center" role="status">
        <Spinner />
        <span className="sr-only">加载中</span>
      </div>
    );
  if (!c.authenticated) return <Login controller={c} />;

  let content;
  if (c.loading && !c.instance) {
    content = (
      <div className="flex flex-col gap-5" role="status" aria-label="读取实例">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  } else if (!c.instance) {
    content = (
      <NoInstance
        error={c.error || "没有找到实例"}
        refresh={c.refresh}
        loading={c.loading}
      />
    );
  } else {
    content = <InstanceView controller={c} />;
  }

  return (
    <ConsoleLayout controller={c}>
      <OperationFeedback controller={c} />
      {content}
    </ConsoleLayout>
  );
}
